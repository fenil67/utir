"""
Static security scanner for confirmed MCP servers.

For each confirmed server that has no scan yet:
  1. Clone the repo (30s timeout, depth=1)
  2. Run bandit (Python) or manual pattern scan (Node/TS)
  3. Run pip-audit or npm audit for dependency vulnerabilities
  4. Detect auth tier (A/B/C/F)
  5. Calculate trust score 0-100
  6. Write a row to the scans table

Usage:
    python static_scan.py
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]

BATCH_SIZE = 10
CLONE_TIMEOUT = 30  # seconds
TOOL_TIMEOUT = 60   # seconds for audit tools


# ── clone ─────────────────────────────────────────────────────────────────────

def clone_repo(github_url: str, dest: str):
    """Shallow-clone with a hard timeout. Raises on failure."""
    result = subprocess.run(
        ["git", "clone", "--depth=1", "--quiet", github_url, dest],
        timeout=CLONE_TIMEOUT,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "git clone exited non-zero")


# ── static analysis ───────────────────────────────────────────────────────────

def run_bandit(repo_dir: Path) -> tuple[list[dict], dict]:
    """
    Run bandit on a Python repo.
    Returns (findings, raw_output).
    findings: list of {severity, confidence, test_id, filename, line, issue_text}
    """
    result = subprocess.run(
        ["bandit", "-r", ".", "-f", "json", "-q"],
        cwd=repo_dir,
        capture_output=True,
        text=True,
        timeout=TOOL_TIMEOUT,
    )
    raw = {}
    findings = []
    try:
        raw = json.loads(result.stdout or result.stderr or "{}")
        for r in raw.get("results", []):
            findings.append({
                "tool": "bandit",
                "severity": r.get("issue_severity", ""),
                "confidence": r.get("issue_confidence", ""),
                "test_id": r.get("test_id", ""),
                "filename": r.get("filename", ""),
                "line": r.get("line_number"),
                "issue": r.get("issue_text", ""),
            })
    except (json.JSONDecodeError, AttributeError):
        pass
    return findings, raw


# Patterns for manual Node/TS scan
_TS_PATTERNS = [
    ("code_injection",    re.compile(r'\beval\s*\(|new\s+Function\s*\(')),
    ("command_exec",      re.compile(r'\bchild_process\b|\bexec\s*\(')),
    # SSRF: fetch/axios/requests called with a variable (not a plain string literal)
    ("potential_ssrf",    re.compile(
        r'(?:fetch|axios\.get|axios\.post|requests\.get|requests\.post)\s*\(\s*(?!["\'])'
    )),
    ("credential_leak",   re.compile(r'process\.env\b.*(?:log|print|console|stdout)',
                                      re.IGNORECASE)),
]

def _read(path: Path) -> str:
    try:
        return path.read_text(errors="replace")
    except OSError:
        return ""


def run_ts_pattern_scan(repo_dir: Path) -> tuple[list[dict], dict]:
    """
    Manual pattern scan for Node/TS repos.
    Returns (findings, raw_output).
    """
    findings = []
    raw: dict[str, list] = {name: [] for name, _ in _TS_PATTERNS}

    extensions = {".ts", ".js", ".mjs", ".cjs"}
    for f in repo_dir.rglob("*"):
        if f.suffix not in extensions:
            continue
        if any(part in {".git", "node_modules", "dist", "build"} for part in f.parts):
            continue
        text = _read(f)
        for name, pattern in _TS_PATTERNS:
            for m in pattern.finditer(text):
                line_no = text[: m.start()].count("\n") + 1
                entry = {
                    "tool": "pattern",
                    "severity": "MEDIUM",
                    "confidence": "MEDIUM",
                    "test_id": name,
                    "filename": str(f.relative_to(repo_dir)),
                    "line": line_no,
                    "issue": name.replace("_", " "),
                }
                findings.append(entry)
                raw[name].append({"file": entry["filename"], "line": line_no})

    return findings, raw


# ── dependency audit ──────────────────────────────────────────────────────────

def run_npm_audit(repo_dir: Path) -> tuple[int, dict]:
    """
    Run npm audit --json. Returns (vuln_count, raw).
    Only runs if package-lock.json or yarn.lock exists (audit needs a lockfile).
    """
    has_lock = (
        (repo_dir / "package-lock.json").exists()
        or (repo_dir / "yarn.lock").exists()
        or (repo_dir / "pnpm-lock.yaml").exists()
    )
    if not has_lock:
        return 0, {"skipped": "no lockfile"}

    result = subprocess.run(
        ["npm", "audit", "--json"],
        cwd=repo_dir,
        capture_output=True,
        text=True,
        timeout=TOOL_TIMEOUT,
    )
    raw = {}
    try:
        raw = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        return 0, {"error": result.stderr.strip()}

    # npm audit v7+ uses "vulnerabilities" dict; v6 uses "advisories"
    vuln_count = (
        raw.get("metadata", {}).get("vulnerabilities", {}).get("total")
        or len(raw.get("vulnerabilities", {}))
        or len(raw.get("advisories", {}))
        or 0
    )
    return int(vuln_count), raw


def run_pip_audit(repo_dir: Path) -> tuple[int, dict]:
    """
    Run pip-audit --format json in the repo dir.
    Returns (vuln_count, raw).
    """
    result = subprocess.run(
        ["pip-audit", "--format", "json", "--progress-spinner", "off"],
        cwd=repo_dir,
        capture_output=True,
        text=True,
        timeout=TOOL_TIMEOUT,
    )
    raw = {}
    try:
        raw = json.loads(result.stdout or result.stderr or "{}")
    except json.JSONDecodeError:
        return 0, {"error": result.stderr.strip()}

    # pip-audit returns {"dependencies": [{"vulns": [...]}]}
    vuln_count = sum(
        len(dep.get("vulns", []))
        for dep in raw.get("dependencies", [])
    )
    return vuln_count, raw


# ── auth tier detection ───────────────────────────────────────────────────────

_AUTH_PATTERNS = {
    "A": re.compile(
        r'authorization_code|oauth2|oidc|pkce|id_token|refresh_token',
        re.IGNORECASE,
    ),
    "B": re.compile(
        r'oauth|access_token|bearer\s+token|jwt\.verify|jsonwebtoken',
        re.IGNORECASE,
    ),
    "C": re.compile(
        r'api[_-]?key|x-api-key|apikey|bearer\s*["\']|Authorization:\s*["\']',
        re.IGNORECASE,
    ),
}

def detect_auth_tier(repo_dir: Path) -> str:
    """
    Scan all source files and return the best auth tier found (A > B > C > F).
    """
    extensions = {".py", ".ts", ".js", ".mjs", ".cjs", ".json", ".yaml", ".yml", ".md"}
    text_corpus = []
    for f in repo_dir.rglob("*"):
        if f.suffix not in extensions:
            continue
        if any(part in {".git", "node_modules", "__pycache__"} for part in f.parts):
            continue
        text_corpus.append(_read(f))

    combined = "\n".join(text_corpus)
    for tier in ("A", "B", "C"):
        if _AUTH_PATTERNS[tier].search(combined):
            return tier
    return "F"


# ── scoring ───────────────────────────────────────────────────────────────────

def calc_static_score(findings: list[dict]) -> int:
    # Only count MEDIUM/HIGH severity for scoring
    significant = [
        f for f in findings
        if f.get("severity", "").upper() in {"MEDIUM", "HIGH"}
    ]
    n = len(significant)
    if n == 0:
        return 25
    if n <= 2:
        return 15
    return 5


def calc_deps_score(vuln_count: int) -> int:
    if vuln_count == 0:
        return 20
    if vuln_count <= 2:
        return 12
    return 4


def calc_auth_score(tier: str) -> int:
    return {"A": 30, "B": 25, "C": 15, "F": 0}.get(tier, 0)


def calc_maintenance_score(last_pushed) -> int:
    if last_pushed is None:
        return 1
    if isinstance(last_pushed, str):
        last_pushed = datetime.fromisoformat(last_pushed.rstrip("Z"))
    # ensure both are offset-naive for comparison
    if last_pushed.tzinfo is not None:
        last_pushed = last_pushed.replace(tzinfo=None)
    now = datetime.utcnow()
    days = (now - last_pushed).days
    if days <= 30:
        return 10
    if days <= 90:
        return 7
    if days <= 365:
        return 4
    return 1


def calc_trust_score(auth_score: int, static_score: int,
                     deps_score: int, maintenance_score: int) -> int:
    return auth_score + static_score + deps_score + maintenance_score


# ── repo type detection ───────────────────────────────────────────────────────

def is_python_repo(repo_dir: Path) -> bool:
    return (
        any(repo_dir.rglob("*.py"))
        or (repo_dir / "pyproject.toml").exists()
        or (repo_dir / "requirements.txt").exists()
    )


def is_node_repo(repo_dir: Path) -> bool:
    return (repo_dir / "package.json").exists()


# ── database ──────────────────────────────────────────────────────────────────

def sanitize_json(data) -> object:
    """Remove null bytes from JSON data that postgres cannot handle."""
    text = json.dumps(data)
    text = text.replace('\\u0000', '').replace('\x00', '')
    return json.loads(text)


def already_scanned(conn, server_id: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM scans WHERE server_id = %s LIMIT 1", (server_id,))
        return cur.fetchone() is not None


def fetch_batch(conn, limit: int) -> list[tuple]:
    """Return (id, github_url, name, last_pushed) for confirmed, unscanned servers."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.github_url, s.name, s.last_pushed
            FROM servers s
            WHERE s.confirmed = TRUE
              AND NOT EXISTS (
                SELECT 1 FROM scans sc WHERE sc.server_id = s.id
              )
            ORDER BY s.created_at ASC
            LIMIT %s
            """,
            (limit,),
        )
        return cur.fetchall()


def count_pending(conn) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) FROM servers s
            WHERE s.confirmed = TRUE
              AND NOT EXISTS (
                SELECT 1 FROM scans sc WHERE sc.server_id = s.id
              )
            """
        )
        return cur.fetchone()[0]


def save_scan(conn, server_id: str, trust_score: int, auth_tier: str,
              static_score: int, deps_score: int, maintenance_score: int,
              findings: list[dict], raw_output: dict, name: str = ""):
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO scans
                  (server_id, trust_score, auth_tier, static_score, deps_score,
                   behavior_score, maintenance_score, findings, raw_output)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    server_id,
                    trust_score,
                    auth_tier,
                    static_score,
                    deps_score,
                    0,          # behavior_score — reserved for dynamic sandbox
                    maintenance_score,
                    psycopg2.extras.Json(sanitize_json(findings)),
                    psycopg2.extras.Json(sanitize_json(raw_output)),
                ),
            )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise RuntimeError(f"DB error for {name}: {e}") from e


# ── per-repo pipeline ─────────────────────────────────────────────────────────

def scan_repo(conn, idx: int, total: int, server_id: str,
              github_url: str, name: str, last_pushed,
              force: bool = False) -> bool:
    prefix = f"Scanned {idx}/{total} [{name}]"

    # Skip if a scan row already exists, unless forced (monitor rescans)
    if not force and already_scanned(conn, server_id):
        print(f"{prefix} — skipped — already scanned", flush=True)
        return False

    tmp = tempfile.mkdtemp(prefix="utir_scan_")
    try:
        # 1. clone
        try:
            clone_repo(github_url, tmp)
        except subprocess.TimeoutExpired:
            print(f"{prefix} — skipped — clone timed out", flush=True)
            return False
        except Exception as e:
            print(f"{prefix} — skipped — clone failed: {e}", flush=True)
            return False

        repo_dir = Path(tmp)
        findings: list[dict] = []
        raw_output: dict = {}
        vuln_count = 0

        # 2. static analysis
        python_repo = is_python_repo(repo_dir)
        node_repo = is_node_repo(repo_dir)

        if python_repo:
            try:
                f, r = run_bandit(repo_dir)
                findings.extend(f)
                raw_output["bandit"] = r
            except subprocess.TimeoutExpired:
                raw_output["bandit"] = {"error": "timeout"}
            except FileNotFoundError:
                raw_output["bandit"] = {"error": "bandit not installed"}
            except Exception as e:
                raw_output["bandit"] = {"error": str(e)}

        if node_repo or (not python_repo):
            # Always run pattern scan for Node/TS; also run for unknown repos
            try:
                f, r = run_ts_pattern_scan(repo_dir)
                findings.extend(f)
                raw_output["pattern_scan"] = r
            except Exception as e:
                raw_output["pattern_scan"] = {"error": str(e)}

        # 3. dependency audit
        if node_repo:
            try:
                vuln_count, r = run_npm_audit(repo_dir)
                raw_output["npm_audit"] = r
            except subprocess.TimeoutExpired:
                raw_output["npm_audit"] = {"error": "timeout"}
            except FileNotFoundError:
                raw_output["npm_audit"] = {"error": "npm not installed"}
            except Exception as e:
                raw_output["npm_audit"] = {"error": str(e)}
        elif python_repo:
            try:
                vuln_count, r = run_pip_audit(repo_dir)
                raw_output["pip_audit"] = r
            except subprocess.TimeoutExpired:
                raw_output["pip_audit"] = {"error": "timeout"}
            except FileNotFoundError:
                raw_output["pip_audit"] = {"error": "pip-audit not installed"}
            except Exception as e:
                raw_output["pip_audit"] = {"error": str(e)}

        # 4. auth tier
        auth_tier = detect_auth_tier(repo_dir)

        # 5. scoring
        s_static = calc_static_score(findings)
        s_deps = calc_deps_score(vuln_count)
        s_auth = calc_auth_score(auth_tier)
        s_maint = calc_maintenance_score(last_pushed)
        trust_score = calc_trust_score(s_auth, s_static, s_deps, s_maint)

        # 6. save
        save_scan(conn, server_id, trust_score, auth_tier,
                  s_static, s_deps, s_maint, findings, raw_output, name=name)

        print(
            f"{prefix} — score: {trust_score}/100 — auth: tier {auth_tier} — "
            f"{len(findings)} finding{'s' if len(findings) != 1 else ''}, "
            f"{vuln_count} vuln{'s' if vuln_count != 1 else ''}",
            flush=True,
        )
        return True

    except Exception as e:
        print(f"{prefix} — error — {e}", flush=True)
        return False
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ── main ──────────────────────────────────────────────────────────────────────

def scan():
    conn = psycopg2.connect(DATABASE_URL)
    try:
        total = count_pending(conn)
        print(f"Found {total} confirmed servers awaiting scan.\n", flush=True)

        processed = 0
        while True:
            batch = fetch_batch(conn, BATCH_SIZE)
            if not batch:
                break

            for server_id, github_url, name, last_pushed in batch:
                processed += 1
                try:
                    scan_repo(conn, processed, total, str(server_id),
                              github_url, name or github_url, last_pushed)
                except Exception as e:
                    print(f"Repo {processed}/{total} [{name}] — unhandled error: {e}",
                          flush=True)

    finally:
        conn.close()

    print(f"\nDone. Scanned {processed} servers.", flush=True)


def main() -> dict:
    """Run the scanner and return a summary dict for the scheduler."""
    conn = psycopg2.connect(DATABASE_URL)
    processed = n_ok = n_skipped = n_errors = 0

    try:
        total = count_pending(conn)
        print(f"Found {total} confirmed servers awaiting scan.\n", flush=True)

        while True:
            batch = fetch_batch(conn, BATCH_SIZE)
            if not batch:
                break

            for server_id, github_url, name, last_pushed in batch:
                processed += 1
                try:
                    ok = scan_repo(conn, processed, total, str(server_id),
                                   github_url, name or github_url, last_pushed)
                    if ok:
                        n_ok += 1
                    else:
                        n_skipped += 1
                except Exception as e:
                    print(f"Repo {processed}/{total} [{name}] — unhandled error: {e}",
                          flush=True)
                    n_errors += 1
    finally:
        conn.close()

    print(f"\nDone. Scanned {n_ok} servers ({n_skipped} skipped, {n_errors} errors).",
          flush=True)
    return {"scanned": n_ok, "skipped": n_skipped, "errors": n_errors}


def scan_single_server(server_id: str, github_url: str) -> int | None:
    """
    Force-rescan a specific server and return the new trust score.
    Always inserts a fresh row in scans (builds history).
    Called by the runtime monitor on high/critical change detection.
    """
    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name, last_pushed FROM servers WHERE id = %s",
                (server_id,),
            )
            row = cur.fetchone()
        if not row:
            return None

        name, last_pushed = row
        print(f"\n[monitor rescan] {name}", flush=True)

        ok = scan_repo(
            conn, 1, 1, server_id, github_url,
            name or github_url, last_pushed,
            force=True,
        )
        if not ok:
            return None

        with conn.cursor() as cur:
            cur.execute(
                "SELECT trust_score FROM scans WHERE server_id = %s "
                "ORDER BY scanned_at DESC LIMIT 1",
                (server_id,),
            )
            score_row = cur.fetchone()
        return score_row[0] if score_row else None
    finally:
        conn.close()


if __name__ == "__main__":
    try:
        scan()
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(1)
