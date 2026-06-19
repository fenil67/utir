"""
GitHub MCP server crawler.
Finds all repos tagged topic:mcp-server and stores them in postgres.
"""

import os
import time
import sys
from datetime import datetime

import requests
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

load_dotenv()

GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
DATABASE_URL = os.environ["DATABASE_URL"]

SEARCH_URL = "https://api.github.com/search/repositories"
HEADERS = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


def fetch_page(page: int) -> dict:
    resp = requests.get(
        SEARCH_URL,
        headers=HEADERS,
        params={
            "q": "topic:mcp-server",
            "per_page": 100,
            "page": page,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def parse_repo(item: dict) -> dict:
    pushed_at = item.get("pushed_at")
    if pushed_at:
        pushed_at = datetime.fromisoformat(pushed_at.rstrip("Z"))
    return {
        "github_url": item["html_url"],
        "name": item["full_name"],
        "description": item.get("description"),
        "language": item.get("language"),
        "stars": item.get("stargazers_count", 0),
        "last_pushed": pushed_at,
        "owner": item["owner"]["login"],
        "topics": item.get("topics", []),
    }


def upsert_servers(conn, rows: list[dict]) -> tuple[int, int]:
    """Insert rows, skip on conflict. Returns (new, known)."""
    if not rows:
        return 0, 0

    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TEMP TABLE _incoming (
                github_url  TEXT,
                name        TEXT,
                description TEXT,
                language    TEXT,
                stars       INTEGER,
                last_pushed TIMESTAMP,
                owner       TEXT,
                topics      TEXT[]
            ) ON COMMIT DROP
            """
        )
        execute_values(
            cur,
            """
            INSERT INTO _incoming
              (github_url, name, description, language, stars, last_pushed, owner, topics)
            VALUES %s
            """,
            [
                (
                    r["github_url"],
                    r["name"],
                    r["description"],
                    r["language"],
                    r["stars"],
                    r["last_pushed"],
                    r["owner"],
                    r["topics"],
                )
                for r in rows
            ],
        )

        # Count how many are already in the DB
        cur.execute(
            """
            SELECT COUNT(*) FROM _incoming i
            JOIN servers s ON s.github_url = i.github_url
            """
        )
        known = cur.fetchone()[0]

        # Upsert — update mutable fields so data stays fresh
        cur.execute(
            """
            INSERT INTO servers
              (github_url, name, description, language, stars, last_pushed, owner, topics)
            SELECT github_url, name, description, language, stars, last_pushed, owner, topics
            FROM _incoming
            ON CONFLICT (github_url) DO UPDATE SET
                name        = EXCLUDED.name,
                description = EXCLUDED.description,
                language    = EXCLUDED.language,
                stars       = EXCLUDED.stars,
                last_pushed = EXCLUDED.last_pushed,
                owner       = EXCLUDED.owner,
                topics      = EXCLUDED.topics,
                updated_at  = NOW()
            """
        )
        new = len(rows) - known

    conn.commit()
    return new, known


def crawl():
    conn = psycopg2.connect(DATABASE_URL)
    try:
        total_new = 0
        total_known = 0
        page = 1

        while True:
            print(f"Fetching page {page}...", flush=True)
            data = fetch_page(page)
            items = data.get("items", [])
            if not items:
                break

            rows = [parse_repo(item) for item in items]
            new, known = upsert_servers(conn, rows)
            total_new += new
            total_known += known

            print(
                f"  Page {page}: {len(rows)} repos — {new} new, {known} already known",
                flush=True,
            )

            # GitHub caps search results at 1000 (10 pages × 100)
            total_count = data.get("total_count", 0)
            if page * 100 >= min(total_count, 1000):
                break

            page += 1
            time.sleep(1)  # respect rate limits

    finally:
        conn.close()

    print(f"\nDone. Found {total_new} new servers, {total_known} already known.")


def main() -> dict:
    """Run the crawler and return a summary dict for the scheduler."""
    conn = psycopg2.connect(DATABASE_URL)
    total_new = 0
    total_known = 0
    errors = 0
    page = 1

    try:
        while True:
            try:
                data = fetch_page(page)
            except Exception as e:
                errors += 1
                print(f"  Page {page} fetch error: {e}", flush=True)
                break

            items = data.get("items", [])
            if not items:
                break

            rows = [parse_repo(item) for item in items]
            new, known = upsert_servers(conn, rows)
            total_new += new
            total_known += known

            print(
                f"  Page {page}: {len(rows)} repos — {new} new, {known} already known",
                flush=True,
            )

            total_count = data.get("total_count", 0)
            if page * 100 >= min(total_count, 1000):
                break

            page += 1
            time.sleep(1)
    finally:
        conn.close()

    print(f"\nDone. Found {total_new} new servers, {total_known} already known.")
    return {"new": total_new, "skipped": total_known, "errors": errors}


if __name__ == "__main__":
    try:
        crawl()
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(1)
