"""
MCP server classifier.
Clones unconfirmed repos, checks whether they are real MCP servers,
extracts tool definitions, and updates the database.

Usage:
    python detector.py            # process all unclassified servers
    python detector.py --resume   # same (classified=true rows are skipped automatically)
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv


load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]

BATCH_SIZE = 50
CLONE_TIMEOUT = 30  # seconds

# ── detection patterns ────────────────────────────────────────────────────────

# package.json dep key
_NPM_SDK = "@modelcontextprotocol/sdk"

# plain-text patterns for requirements.txt / pyproject.toml
_PY_DEP_RE = re.compile(r'(?i)(^|[\s"\'])mcp([>=<!;\s"\'\[,]|$)', re.MULTILINE)

# import lines in source files
_PY_IMPORT_RE = re.compile(
    r'^\s*(?:from\s+mcp(?:\.\S+)?\s+import|import\s+mcp(?:\.\S+)?)',
    re.MULTILINE,
)
_TS_IMPORT_RE = re.compile(
    r'''['"]@modelcontextprotocol/''',
    re.MULTILINE,
)

# tool extraction
# Python: @server.tool() or @mcp.tool()  — captures optional string arg as name
_PY_TOOL_DECO_RE = re.compile(
    r'@\w+\.tool\(\s*(?:["\'](?P<name>[^"\']+)["\'])?\s*\)',
)
_PY_FUNC_RE = re.compile(r'def\s+(\w+)\s*\(')
# Python docstring immediately after def line
_PY_DOCSTRING_RE = re.compile(r'^\s*"""(.*?)"""', re.DOTALL)

# TypeScript: server.tool("name", "description", …)
_TS_TOOL_RE = re.compile(
    r'server\.tool\(\s*["\'](?P<name>[^"\']+)["\']\s*'
    r'(?:,\s*["\'](?P<desc>[^"\']*)["\'])?',
)


# ── detection logic ───────────────────────────────────────────────────────────

def _read(path: Path) -> str:
    try:
        return path.read_text(errors="replace")
    except OSError:
        return ""


def check_npm_sdk(repo_dir: Path) -> bool:
    pkg = repo_dir / "package.json"
    if not pkg.exists():
        return False
    try:
        data = json.loads(pkg.read_text())
    except (json.JSONDecodeError, OSError):
        return False
    deps = {
        **data.get("dependencies", {}),
        **data.get("devDependencies", {}),
        **data.get("peerDependencies", {}),
    }
    return _NPM_SDK in deps


def check_py_deps(repo_dir: Path) -> bool:
    for fname in ("requirements.txt", "requirements-dev.txt",
                  "pyproject.toml", "setup.cfg", "setup.py"):
        for f in repo_dir.rglob(fname):
            if _PY_DEP_RE.search(_read(f)):
                return True
    return False


def check_source_imports(repo_dir: Path) -> bool:
    for f in repo_dir.rglob("*.py"):
        if _PY_IMPORT_RE.search(_read(f)):
            return True
    for f in repo_dir.rglob("*.ts"):
        if _TS_IMPORT_RE.search(_read(f)):
            return True
    return False


def detect(repo_dir: Path) -> tuple[bool, str]:
    """Return (is_mcp, reason)."""
    if check_npm_sdk(repo_dir):
        return True, "package.json contains @modelcontextprotocol/sdk"
    if check_py_deps(repo_dir):
        return True, "Python dep file contains mcp"
    if check_source_imports(repo_dir):
        return True, "source file imports mcp / @modelcontextprotocol"
    return False, "no MCP indicators found"


# ── tool extraction ───────────────────────────────────────────────────────────

def extract_tools_python(repo_dir: Path) -> list[dict]:
    tools = []
    for f in repo_dir.rglob("*.py"):
        text = _read(f)
        lines = text.splitlines()
        for i, line in enumerate(lines):
            m = _PY_TOOL_DECO_RE.search(line)
            if not m:
                continue
            # find the next def statement
            name = m.group("name")
            desc = ""
            for j in range(i + 1, min(i + 5, len(lines))):
                fn = _PY_FUNC_RE.search(lines[j])
                if fn:
                    if not name:
                        name = fn.group(1)
                    # look for docstring in the body
                    body = "\n".join(lines[j + 1: j + 10])
                    ds = _PY_DOCSTRING_RE.search(body)
                    if ds:
                        desc = ds.group(1).strip().splitlines()[0].strip()
                    break
            if name:
                tools.append({"name": name, "description": desc or None})
    return tools


def extract_tools_typescript(repo_dir: Path) -> list[dict]:
    tools = []
    for f in repo_dir.rglob("*.ts"):
        text = _read(f)
        for m in _TS_TOOL_RE.finditer(text):
            tools.append({
                "name": m.group("name"),
                "description": m.group("desc") or None,
            })
    return tools


def extract_tools(repo_dir: Path) -> list[dict]:
    seen = set()
    results = []
    for t in extract_tools_python(repo_dir) + extract_tools_typescript(repo_dir):
        if t["name"] not in seen:
            seen.add(t["name"])
            results.append(t)
    return results


# ── database helpers ──────────────────────────────────────────────────────────

def ensure_classified_column(conn):
    with conn.cursor() as cur:
        cur.execute(
            "ALTER TABLE servers ADD COLUMN IF NOT EXISTS classified BOOLEAN DEFAULT FALSE"
        )
    conn.commit()


def count_unclassified(conn) -> int:
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM servers WHERE classified IS NOT TRUE OR classified IS NULL")
        return cur.fetchone()[0]


def fetch_batch(conn, limit: int) -> list[tuple]:
    """Return (id, github_url, name) for servers not yet classified."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, github_url, name
            FROM servers
            WHERE classified IS NOT TRUE OR classified IS NULL
            ORDER BY created_at ASC
            LIMIT %s
            """,
            (limit,),
        )
        return cur.fetchall()


def mark_done(conn, server_id: str, confirmed: bool):
    """Set both confirmed and classified in a single commit."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE servers
            SET confirmed = %s, classified = TRUE, updated_at = NOW()
            WHERE id = %s
            """,
            (confirmed, server_id),
        )
    conn.commit()


def insert_tools(conn, server_id: str, tools: list[dict]):
    if not tools:
        return
    with conn.cursor() as cur:
        cur.execute("DELETE FROM tools WHERE server_id = %s", (server_id,))
        execute_values(
            cur,
            "INSERT INTO tools (server_id, name, description) VALUES %s",
            [(server_id, t["name"], t.get("description")) for t in tools],
        )
    conn.commit()


# ── main loop ─────────────────────────────────────────────────────────────────

def clone_repo(github_url: str, dest: str):
    """Shallow-clone with a hard timeout. Raises on failure."""
    result = subprocess.run(
        ["git", "clone", "--depth=1", "--no-single-branch", "--quiet",
         github_url, dest],
        timeout=CLONE_TIMEOUT,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "git clone exited non-zero")


def process_repo(conn, idx: int, total: int, server_id: str,
                 github_url: str, name: str) -> str:
    """
    Clone, classify, extract tools, update DB.
    Returns "confirmed", "rejected", or "error".
    Always marks classified=TRUE and cleans up the temp dir.
    """
    prefix = f"Repo {idx}/{total} [{name}]"
    tmp = tempfile.mkdtemp(prefix="utir_")
    outcome = "error"
    try:
        try:
            clone_repo(github_url, tmp)
        except subprocess.TimeoutExpired:
            print(f"{prefix} — rejected — clone timed out after {CLONE_TIMEOUT}s",
                  flush=True)
            mark_done(conn, server_id, confirmed=False)
            return "rejected"
        except Exception as e:
            print(f"{prefix} — rejected — clone failed: {e}", flush=True)
            mark_done(conn, server_id, confirmed=False)
            return "rejected"

        repo_dir = Path(tmp)
        is_mcp, reason = detect(repo_dir)

        if is_mcp:
            tools = extract_tools(repo_dir)
            mark_done(conn, server_id, confirmed=True)
            insert_tools(conn, server_id, tools)
            print(
                f"{prefix} — confirmed — {reason} "
                f"({len(tools)} tool{'s' if len(tools) != 1 else ''} found)",
                flush=True,
            )
            outcome = "confirmed"
        else:
            mark_done(conn, server_id, confirmed=False)
            print(f"{prefix} — rejected — {reason}", flush=True)
            outcome = "rejected"

    except Exception as e:
        print(f"{prefix} — error — {e}", flush=True)
        try:
            mark_done(conn, server_id, confirmed=False)
        except Exception:
            pass
        outcome = "error"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    return outcome


def classify():
    conn = psycopg2.connect(DATABASE_URL)
    try:
        ensure_classified_column(conn)

        total = count_unclassified(conn)
        print(f"Found {total} unclassified servers to process.\n", flush=True)

        n_confirmed = n_rejected = n_errors = 0
        processed = 0

        while True:
            batch = fetch_batch(conn, BATCH_SIZE)
            if not batch:
                break

            for server_id, github_url, nm in batch:
                processed += 1
                sid = str(server_id)

                try:
                    outcome = process_repo(conn, processed, total, sid,
                                           github_url, nm or github_url)
                except Exception as e:
                    print(f"Repo {processed}/{total} [{nm}] — error — unhandled: {e}",
                          flush=True)
                    outcome = "error"
                    try:
                        mark_done(conn, sid, confirmed=False)
                    except Exception:
                        pass

                if outcome == "confirmed":
                    n_confirmed += 1
                elif outcome == "rejected":
                    n_rejected += 1
                else:
                    n_errors += 1

                if processed % 50 == 0:
                    print(
                        f"\nProgress: {processed}/{total} — "
                        f"{n_confirmed} confirmed, {n_rejected} rejected\n",
                        flush=True,
                    )

    finally:
        conn.close()

    print(
        f"\nDone. {processed} processed — "
        f"{n_confirmed} confirmed, {n_rejected} rejected, {n_errors} errors.",
        flush=True,
    )


def main() -> dict:
    """Run the classifier and return a summary dict for the scheduler."""
    conn = psycopg2.connect(DATABASE_URL)
    n_confirmed = n_rejected = n_errors = 0
    processed = 0
    seen_ids: set[str] = set()

    try:
        ensure_classified_column(conn)
        total = count_unclassified(conn)
        print(f"Found {total} unclassified servers to process.\n", flush=True)

        while True:
            batch = fetch_batch(conn, BATCH_SIZE)
            if not batch:
                break

            batch = [(sid, url, nm) for sid, url, nm in batch
                     if str(sid) not in seen_ids]
            if not batch:
                break

            for server_id, github_url, nm in batch:
                processed += 1
                sid = str(server_id)
                seen_ids.add(sid)

                try:
                    outcome = process_repo(conn, processed, total, sid,
                                           github_url, nm or github_url)
                except Exception as e:
                    print(f"Repo {processed}/{total} [{nm}] — unhandled: {e}", flush=True)
                    outcome = "error"
                    try:
                        mark_done(conn, sid, confirmed=False)
                    except Exception:
                        pass

                if outcome == "confirmed":
                    n_confirmed += 1
                elif outcome == "rejected":
                    n_rejected += 1
                else:
                    n_errors += 1

                if processed % 50 == 0:
                    print(
                        f"\nProgress: {processed}/{total} — "
                        f"{n_confirmed} confirmed, {n_rejected} rejected\n",
                        flush=True,
                    )
    finally:
        conn.close()

    print(
        f"\nDone. {processed} processed — "
        f"{n_confirmed} confirmed, {n_rejected} rejected, {n_errors} errors.",
        flush=True,
    )
    return {"classified": processed, "confirmed": n_confirmed,
            "rejected": n_rejected, "errors": n_errors}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Classify MCP servers from the DB.")
    # --resume is now a no-op (kept for backwards compat with any scripts that call it)
    parser.add_argument("--resume", action="store_true",
                        help="No-op: progress is tracked in the DB via classified column")
    args = parser.parse_args()

    try:
        classify()
    except KeyboardInterrupt:
        print("\nInterrupted. Re-run to continue — already-classified rows are skipped.",
              file=sys.stderr)
        sys.exit(1)
