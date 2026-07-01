"""
Re-extract tools for all confirmed servers using the improved extractor.

Reads confirmed servers from the DB, clones each repo, runs the improved
tool extraction from classifier/detector.py, and updates the tools table.

Usage:
    python scanner/reextract_tools.py
    python scanner/reextract_tools.py --limit 50   # process at most N servers
    python scanner/reextract_tools.py --dry-run     # extract but don't write to DB
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

# Pull in the extractor from the classifier package
sys.path.insert(0, str(Path(__file__).parent.parent))
from classifier.detector import extract_tools

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]

CLONE_TIMEOUT = 30   # seconds per repo
BATCH_SIZE    = 10   # repos cloned at a time before disk cleanup


# ── database ──────────────────────────────────────────────────────────────────

def fetch_confirmed_servers(conn, limit: int | None) -> list[tuple]:
    """Return (id, github_url, name) for all confirmed servers."""
    sql = """
        SELECT id, github_url, name
        FROM servers
        WHERE confirmed = TRUE
        ORDER BY stars DESC, created_at ASC
    """
    if limit:
        sql += f" LIMIT {int(limit)}"
    with conn.cursor() as cur:
        cur.execute(sql)
        return cur.fetchall()


def fetch_server_by_name(conn, name: str) -> list[tuple]:
    """Return [(id, github_url, name)] for a single server matching the given name."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, github_url, name FROM servers WHERE name = %s",
            (name,),
        )
        row = cur.fetchone()
    if not row:
        print(f"No server found with name: {name!r}", file=sys.stderr)
        sys.exit(1)
    return [row]


def update_tools(conn, server_id: str, tools: list[dict]) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM tools WHERE server_id = %s", (server_id,))
        if tools:
            execute_values(
                cur,
                "INSERT INTO tools (server_id, name, description) VALUES %s",
                [(server_id, t["name"], t.get("description")) for t in tools],
            )
    conn.commit()


# ── clone ─────────────────────────────────────────────────────────────────────

def clone_repo(github_url: str, dest: str) -> None:
    result = subprocess.run(
        ["git", "clone", "--depth=1", "--quiet", github_url, dest],
        timeout=CLONE_TIMEOUT,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "git clone exited non-zero")


# ── main ──────────────────────────────────────────────────────────────────────

def run(limit: int | None = None, dry_run: bool = False, server: str | None = None) -> None:
    conn = psycopg2.connect(DATABASE_URL)
    try:
        if server:
            servers = fetch_server_by_name(conn, server)
        else:
            servers = fetch_confirmed_servers(conn, limit)
    except Exception as e:
        conn.close()
        print(f"Failed to fetch servers: {e}", file=sys.stderr)
        sys.exit(1)

    total = len(servers)
    print(f"Re-extracting tools for {total} confirmed server(s).\n", flush=True)

    total_tools = 0
    errors = 0

    # Process in batches of BATCH_SIZE to keep disk usage bounded
    for batch_start in range(0, total, BATCH_SIZE):
        batch = servers[batch_start: batch_start + BATCH_SIZE]
        tmpdirs: list[str] = []

        try:
            for idx_in_batch, (server_id, github_url, name) in enumerate(batch):
                global_idx = batch_start + idx_in_batch + 1
                label = name or github_url
                sid = str(server_id)

                tmp = tempfile.mkdtemp(prefix="utir_reextract_")
                tmpdirs.append(tmp)

                try:
                    clone_repo(github_url, tmp)
                except subprocess.TimeoutExpired:
                    print(
                        f"  {global_idx}/{total} [{label}] — skipped (clone timeout)",
                        flush=True,
                    )
                    errors += 1
                    continue
                except Exception as e:
                    print(
                        f"  {global_idx}/{total} [{label}] — skipped (clone error: {e})",
                        flush=True,
                    )
                    errors += 1
                    continue

                try:
                    tools = extract_tools(Path(tmp))
                except Exception as e:
                    print(
                        f"  {global_idx}/{total} [{label}] — extract error: {e}",
                        flush=True,
                    )
                    errors += 1
                    continue

                n = len(tools)
                total_tools += n

                if not dry_run:
                    try:
                        update_tools(conn, sid, tools)
                    except Exception as e:
                        print(
                            f"  {global_idx}/{total} [{label}] — DB write error: {e}",
                            flush=True,
                        )
                        errors += 1
                        continue

                suffix = " (dry-run)" if dry_run else ""
                print(
                    f"  {global_idx}/{total} [{label}] — found {n} tool{'s' if n != 1 else ''}{suffix}",
                    flush=True,
                )

        finally:
            # Clean up all temp dirs for this batch regardless of outcome
            for d in tmpdirs:
                shutil.rmtree(d, ignore_errors=True)

    print(
        f"\nDone. {total} servers processed, "
        f"{total_tools} total tools extracted"
        + (f", {errors} error(s)" if errors else "")
        + (" [dry-run — no DB writes]" if dry_run else "")
        + ".",
        flush=True,
    )
    conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Re-extract tools for confirmed MCP servers."
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Process at most N servers (default: all)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Extract tools but do not write to DB",
    )
    parser.add_argument(
        "--server", type=str, default=None,
        help="Process only this server by name (e.g. 'ChromeDevTools/chrome-devtools-mcp')",
    )
    args = parser.parse_args()

    try:
        run(limit=args.limit, dry_run=args.dry_run, server=args.server)
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
