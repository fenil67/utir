"""
Runtime monitor — detects changes to already-listed MCP servers.

Runs nightly after the main pipeline. For every confirmed server
that has at least one scan, it:
  1. Fetches current repo state from the GitHub API
  2. Detects new commits, dependency changes, owner transfers,
     tool schema changes, README changes, and score trends
  3. Triggers an immediate rescan on high/critical changes
  4. Records all findings to monitor_events

Usage:
    python monitor/agent.py
"""

import base64
import logging
import os
import re
import sys
import time
from pathlib import Path

import psycopg2
import psycopg2.extras
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

log = logging.getLogger("monitor")

DATABASE_URL  = os.environ["DATABASE_URL"]
GITHUB_TOKEN  = os.environ.get("GITHUB_TOKEN")
MAX_SERVERS   = 200
API_SLEEP     = 0.5   # seconds between GitHub API calls

# Severity as an orderable value
SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}

DEP_FILES = ["package.json", "requirements.txt", "pyproject.toml", "package-lock.json"]

# Source file extensions to scan for tool names
SOURCE_EXTS = (".py", ".js", ".ts", ".mjs")


# ── GitHub API helper ─────────────────────────────────────────────────────────

def _make_session() -> requests.Session:
    s = requests.Session()
    s.headers["Accept"] = "application/vnd.github.v3+json"
    if GITHUB_TOKEN:
        s.headers["Authorization"] = f"token {GITHUB_TOKEN}"
    return s


# ── RuntimeMonitor ────────────────────────────────────────────────────────────

class RuntimeMonitor:

    def __init__(self):
        self.conn    = psycopg2.connect(DATABASE_URL)
        self.session = _make_session()

    # ── public entry point ────────────────────────────────────────────────────

    def run(self) -> dict:
        self._ensure_schema()
        servers = self.get_servers_to_monitor()
        log.info("Monitoring %d servers", len(servers))

        checked = changed = rescanned = errors = 0

        for server in servers:
            try:
                changes = self.detect_changes(server)
                checked += 1
                if changes:
                    rescanned_now = self.handle_changes(server, changes)
                    changed   += 1
                    rescanned += int(rescanned_now)
                self._update_last_monitored(server["id"])
            except Exception as exc:
                errors += 1
                log.error("Error monitoring %s: %s", server.get("name"), exc, exc_info=True)
            # brief pause so we don't hammer GitHub between servers
            time.sleep(API_SLEEP)

        self.conn.close()
        log.info(
            "Monitor complete — checked:%d changed:%d rescanned:%d errors:%d",
            checked, changed, rescanned, errors,
        )
        return {"checked": checked, "changed": changed,
                "rescanned": rescanned, "errors": errors}

    # ── schema bootstrap ──────────────────────────────────────────────────────

    def _ensure_schema(self):
        with self.conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS monitor_events (
                    id               UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
                    server_id        UUID      REFERENCES servers(id) ON DELETE CASCADE,
                    detected_at      TIMESTAMP NOT NULL DEFAULT NOW(),
                    change_type      TEXT      NOT NULL,
                    severity         TEXT      NOT NULL,
                    detail           TEXT,
                    old_value        TEXT,
                    new_value        TEXT,
                    rescan_triggered BOOLEAN   NOT NULL DEFAULT FALSE,
                    rescan_score     INTEGER,
                    acknowledged     BOOLEAN   NOT NULL DEFAULT FALSE
                )
            """)
            cur.execute("""
                ALTER TABLE servers
                    ADD COLUMN IF NOT EXISTS monitor_flag   TEXT      DEFAULT NULL,
                    ADD COLUMN IF NOT EXISTS last_monitored TIMESTAMP DEFAULT NULL,
                    ADD COLUMN IF NOT EXISTS readme_hash    TEXT      DEFAULT NULL
            """)
        self.conn.commit()

    # ── server selection ──────────────────────────────────────────────────────

    def get_servers_to_monitor(self) -> list[dict]:
        """
        Return confirmed servers that have been scanned at least once.
        Prioritise high-star and recently-active repos; cap at MAX_SERVERS.
        """
        with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT
                    s.id, s.name, s.github_url, s.owner, s.stars,
                    s.last_pushed, s.monitor_flag, s.readme_hash,
                    sc.trust_score, sc.auth_tier,
                    sc.scanned_at AS last_scanned
                FROM servers s
                JOIN LATERAL (
                    SELECT trust_score, auth_tier, scanned_at
                    FROM scans
                    WHERE server_id = s.id
                    ORDER BY scanned_at DESC
                    LIMIT 1
                ) sc ON TRUE
                WHERE s.confirmed = TRUE
                ORDER BY s.stars DESC NULLS LAST, sc.scanned_at ASC
                LIMIT %s
            """, (MAX_SERVERS,))
            return [dict(r) for r in cur.fetchall()]

    # ── GitHub helpers ────────────────────────────────────────────────────────

    def _gh(self, path: str, **params):
        url = f"https://api.github.com{path}"
        r = self.session.get(url, params=params or None, timeout=15)
        r.raise_for_status()
        return r.json()

    @staticmethod
    def _parse_owner_repo(server: dict) -> tuple[str, str]:
        parts = server["github_url"].rstrip("/").split("/")
        return parts[-2], parts[-1]

    @staticmethod
    def _iso(dt) -> str | None:
        if dt is None:
            return None
        return dt.isoformat() if hasattr(dt, "isoformat") else str(dt)

    def _fetch_file_content(self, owner: str, repo: str, path: str) -> str | None:
        """Fetch a single file from GitHub and return its decoded text content."""
        try:
            data = self._gh(f"/repos/{owner}/{repo}/contents/{path}")
            if isinstance(data, dict) and data.get("encoding") == "base64":
                return base64.b64decode(data["content"]).decode("utf-8", errors="replace")
        except Exception:
            return None
        return None

    @staticmethod
    def _extract_tool_names(content: str, filename: str) -> list[str]:
        """
        Extract MCP tool names from source file content.
        Python: decorated functions (@something.tool)
        JS/TS:  server.tool("name", ...)
        """
        names = []
        if filename.endswith(".py"):
            # Matches @mcp.tool / @server.tool / @app.tool etc.
            for m in re.finditer(
                r'@\w+\.tool\b[^\n]*\n\s*(?:async\s+)?def\s+(\w+)',
                content,
            ):
                names.append(m.group(1))
        elif filename.endswith(SOURCE_EXTS):
            # Matches .tool("name" or 'name'
            for m in re.finditer(r'\.tool\(\s*["\']([^"\']+)["\']', content):
                names.append(m.group(1))
        return names

    # ── change detectors ──────────────────────────────────────────────────────

    def get_recent_commits(self, server: dict) -> list[dict]:
        owner, repo = self._parse_owner_repo(server)
        since = self._iso(server.get("last_scanned"))
        params = {"per_page": 10}
        if since:
            params["since"] = since
        try:
            data = self._gh(f"/repos/{owner}/{repo}/commits", **params)
            return [
                {
                    "sha":     c["sha"],
                    "message": c["commit"]["message"].split("\n")[0][:200],
                    "date":    c["commit"]["committer"]["date"],
                }
                for c in (data or [])
            ]
        except Exception as exc:
            log.warning("Could not fetch commits for %s: %s", server["name"], exc)
            return []

    def check_dependency_changes(self, server: dict, since: str | None) -> str | None:
        """
        Returns a description string if any dep file was touched since last scan,
        or None if nothing changed.
        """
        if not since:
            return None
        owner, repo = self._parse_owner_repo(server)
        for dep_file in DEP_FILES:
            try:
                time.sleep(0.2)
                data = self._gh(
                    f"/repos/{owner}/{repo}/commits",
                    path=dep_file,
                    since=since,
                    per_page=1,
                )
                if data:
                    sha = data[0]["sha"][:7]
                    return f"{dep_file} modified since last scan (commit {sha})"
            except Exception:
                continue
        return None

    def get_repo_info(self, server: dict) -> dict | None:
        owner, repo = self._parse_owner_repo(server)
        try:
            return self._gh(f"/repos/{owner}/{repo}")
        except Exception as exc:
            log.warning("Could not fetch repo info for %s: %s", server["name"], exc)
            return None

    def check_tool_changes(self, server: dict) -> str | None:
        """
        Check 5: Detect added or removed tools by scanning source files.
        Returns a detail string on change, None if unchanged or undetectable.
        """
        owner, repo = self._parse_owner_repo(server)

        # Fetch root directory listing
        try:
            root_entries = self._gh(f"/repos/{owner}/{repo}/contents/")
        except Exception as exc:
            log.warning("Could not fetch contents for %s: %s", server["name"], exc)
            return None

        if not isinstance(root_entries, list):
            return None

        source_files = [
            e["path"] for e in root_entries
            if isinstance(e, dict)
            and e.get("type") == "file"
            and e.get("name", "").endswith(SOURCE_EXTS)
            and not e.get("name", "").startswith(".")
        ]

        # Scan up to 5 files to keep API calls reasonable
        current_tools: set[str] = set()
        for fpath in source_files[:5]:
            time.sleep(0.2)
            content = self._fetch_file_content(owner, repo, fpath)
            if content:
                current_tools.update(
                    self._extract_tool_names(content, fpath)
                )

        if not current_tools:
            return None  # Couldn't extract tool names — skip

        # Compare against DB tools
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT name FROM tools WHERE server_id = %s",
                (server["id"],),
            )
            db_tools = {row[0] for row in cur.fetchall()}

        if not db_tools:
            return None  # Nothing in DB to compare against

        added   = current_tools - db_tools
        removed = db_tools - current_tools

        if not added and not removed:
            return None

        parts = []
        if added:
            parts.append(f"added: {', '.join(sorted(added))}")
        if removed:
            parts.append(f"removed: {', '.join(sorted(removed))}")
        return f"Tool schema changed — {'; '.join(parts)}"

    def check_readme_change(self, server: dict) -> str | None:
        """
        Check 6: Detect README changes by comparing SHA from GitHub API.
        Updates servers.readme_hash on each call. Returns detail string on change.
        """
        owner, repo = self._parse_owner_repo(server)
        try:
            data = self._gh(f"/repos/{owner}/{repo}/readme")
            current_sha = data.get("sha")
        except Exception:
            return None  # Repo may have no README

        if not current_sha:
            return None

        stored_sha = server.get("readme_hash")

        # Always update the stored hash
        with self.conn.cursor() as cur:
            cur.execute(
                "UPDATE servers SET readme_hash = %s WHERE id = %s",
                (current_sha, server["id"]),
            )
        self.conn.commit()

        if stored_sha is None:
            return None  # First observation — no change to report

        if current_sha != stored_sha:
            return (
                f"README changed "
                f"(was {stored_sha[:7]}, now {current_sha[:7]})"
            )

        return None

    def check_score_trend(self, server: dict) -> str | None:
        """
        Check 8: Detect a consistent downward score trend across the last 3 scans.
        Returns a detail string if each scan is lower than the previous one.
        """
        with self.conn.cursor() as cur:
            cur.execute("""
                SELECT trust_score FROM scans
                WHERE server_id = %s AND trust_score IS NOT NULL
                ORDER BY scanned_at DESC
                LIMIT 3
            """, (server["id"],))
            rows = cur.fetchall()

        # scores[0] = most recent, scores[2] = oldest
        scores = [row[0] for row in rows]

        if len(scores) < 3:
            return None

        if scores[0] < scores[1] < scores[2]:
            return f"Score trending down: {scores[2]} → {scores[1]} → {scores[0]}"

        return None

    # ── main detection logic ──────────────────────────────────────────────────

    def detect_changes(self, server: dict) -> list[dict]:
        changes = []

        # Single call: current owner + star count
        repo_info = self.get_repo_info(server)
        time.sleep(API_SLEEP)

        if repo_info:
            # Check 1: owner transfer (critical)
            current_owner = (repo_info.get("owner") or {}).get("login", "")
            stored_owner  = server.get("owner") or ""
            if current_owner and stored_owner and \
               current_owner.lower() != stored_owner.lower():
                changes.append({
                    "type":      "owner_changed",
                    "severity":  "critical",
                    "detail":    f"Owner changed from {stored_owner} to {current_owner}",
                    "old_value": stored_owner,
                    "new_value": current_owner,
                })

            # Check 2: star spike — 5× growth is suspicious
            current_stars = repo_info.get("stargazers_count", 0)
            stored_stars  = server.get("stars") or 0
            if stored_stars > 10 and current_stars >= stored_stars * 5:
                changes.append({
                    "type":      "star_spike",
                    "severity":  "medium",
                    "detail":    f"Stars jumped from {stored_stars} to {current_stars} — unusual growth",
                    "old_value": str(stored_stars),
                    "new_value": str(current_stars),
                })

        # Check 3: new commits since last scan (medium)
        commits = self.get_recent_commits(server)
        time.sleep(API_SLEEP)
        if commits:
            changes.append({
                "type":      "new_commits",
                "severity":  "medium",
                "detail":    f"{len(commits)} new commit(s) since last scan",
                "old_value": None,
                "new_value": commits[0]["sha"],
            })

            # Check 4: dependency file changes (high) — only worth checking
            # if there ARE new commits
            since = self._iso(server.get("last_scanned"))
            dep_detail = self.check_dependency_changes(server, since)
            if dep_detail:
                changes.append({
                    "type":      "dependency_change",
                    "severity":  "high",
                    "detail":    dep_detail,
                    "old_value": None,
                    "new_value": dep_detail,
                })

        # Check 5: tool schema changes (high)
        time.sleep(API_SLEEP)
        tool_detail = self.check_tool_changes(server)
        if tool_detail:
            changes.append({
                "type":      "tool_schema_changed",
                "severity":  "high",
                "detail":    tool_detail,
                "old_value": None,
                "new_value": tool_detail,
            })

        # Check 6: README changes (medium)
        time.sleep(API_SLEEP)
        readme_detail = self.check_readme_change(server)
        if readme_detail:
            changes.append({
                "type":      "readme_changed",
                "severity":  "medium",
                "detail":    readme_detail,
                "old_value": None,
                "new_value": readme_detail,
            })

        # Check 8: consistent score drop trend (medium) — DB-only, no API call
        trend_detail = self.check_score_trend(server)
        if trend_detail:
            changes.append({
                "type":      "score_trend_down",
                "severity":  "medium",
                "detail":    trend_detail,
                "old_value": None,
                "new_value": trend_detail,
            })

        return changes

    # ── change handling ───────────────────────────────────────────────────────

    def handle_changes(self, server: dict, changes: list[dict]) -> bool:
        """Save events, optionally rescan, flag server. Returns True if rescan ran."""
        severity = max(
            changes,
            key=lambda c: SEVERITY_RANK.get(c["severity"], 0),
        )["severity"]

        should_rescan = severity in ("high", "critical")
        new_score: int | None    = None
        new_auth_tier: str | None = None

        if should_rescan:
            new_score, new_auth_tier = self.trigger_rescan(server)

            # Check 7: auth removed after rescan (critical)
            old_tier = server.get("auth_tier")
            if old_tier in ("A", "B") and new_auth_tier == "F":
                changes.append({
                    "type":      "auth_removed",
                    "severity":  "critical",
                    "detail":    f"Authentication removed: was Tier {old_tier}, now Tier F (no auth detected)",
                    "old_value": old_tier,
                    "new_value": "F",
                })
                self._flag_server(server["id"], "critical")
                log.warning(
                    "%s lost authentication (Tier %s → F) — flagged critical",
                    server["name"], old_tier,
                )

        for change in changes:
            self._save_monitor_event(
                server,
                change,
                rescan_triggered=should_rescan,
                rescan_score=new_score,
            )

        log.info(
            "%s — %d change(s), severity=%s, rescan=%s, new_score=%s",
            server["name"], len(changes), severity, should_rescan, new_score,
        )
        return should_rescan

    def trigger_rescan(self, server: dict) -> tuple[int | None, str | None]:
        """
        Run a fresh security scan. Returns (new_trust_score, new_auth_tier).
        """
        try:
            from scanner.static_scan import scan_single_server
            new_score = scan_single_server(server["id"], server["github_url"])

            # Fetch the auth_tier that was written by the rescan
            new_auth_tier: str | None = None
            with self.conn.cursor() as cur:
                cur.execute("""
                    SELECT auth_tier FROM scans
                    WHERE server_id = %s
                    ORDER BY scanned_at DESC
                    LIMIT 1
                """, (server["id"],))
                row = cur.fetchone()
                if row:
                    new_auth_tier = row[0]

            if new_score is not None:
                old_score = server.get("trust_score") or 0
                if old_score - new_score > 15:
                    self._flag_server(server["id"], "warning")
                    log.warning(
                        "%s score dropped %d → %d — flagged as warning",
                        server["name"], old_score, new_score,
                    )

            return new_score, new_auth_tier
        except Exception as exc:
            log.error("Rescan failed for %s: %s", server["name"], exc)
            return None, None

    # ── DB writes ─────────────────────────────────────────────────────────────

    def _save_monitor_event(self, server: dict, change: dict,
                            rescan_triggered: bool, rescan_score: int | None):
        with self.conn.cursor() as cur:
            cur.execute("""
                INSERT INTO monitor_events
                    (server_id, change_type, severity, detail,
                     old_value, new_value, rescan_triggered, rescan_score)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                server["id"],
                change["type"],
                change["severity"],
                change.get("detail"),
                change.get("old_value"),
                change.get("new_value"),
                rescan_triggered,
                rescan_score,
            ))
        self.conn.commit()

    def _flag_server(self, server_id: str, flag: str):
        with self.conn.cursor() as cur:
            cur.execute(
                "UPDATE servers SET monitor_flag = %s WHERE id = %s",
                (flag, server_id),
            )
        self.conn.commit()

    def _update_last_monitored(self, server_id: str):
        with self.conn.cursor() as cur:
            cur.execute(
                "UPDATE servers SET last_monitored = NOW() WHERE id = %s",
                (server_id,),
            )
        self.conn.commit()


# ── entry points ──────────────────────────────────────────────────────────────

def main() -> dict:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )
    monitor = RuntimeMonitor()
    return monitor.run()


if __name__ == "__main__":
    result = main()
    print(result)
