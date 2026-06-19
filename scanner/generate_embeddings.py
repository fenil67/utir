"""
Generate OpenAI embeddings for all confirmed servers that don't have one yet.

Usage:
    python scanner/generate_embeddings.py          # embed all missing
    python scanner/generate_embeddings.py --dry-run  # estimate cost only

Writes to the servers.embedding column (vector(1536)).
"""

import logging
import os
import sys
import time
from pathlib import Path

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from openai import OpenAI

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

log = logging.getLogger("embeddings")

DATABASE_URL = os.environ["DATABASE_URL"]
BATCH_SIZE   = 50
SLEEP_SECS   = 1.0  # between batches

# text-embedding-3-small: $0.02 per 1M tokens
COST_PER_TOKEN = 0.02 / 1_000_000
AVG_TOKENS     = 500  # conservative estimate per server


def build_text(server: dict, tools: list[dict]) -> str:
    tool_parts = [
        f"{t['name']}: {t['description']}"
        for t in tools
        if t.get("name")
    ]
    tool_str = ", ".join(tool_parts) if tool_parts else ""
    return (
        f"{server['name']}. "
        f"{server['description'] or ''}. "
        f"Tools: {tool_str}"
    ).strip()


def fetch_pending(conn) -> list[dict]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT id, name, description
            FROM servers
            WHERE confirmed = TRUE
              AND (embedding IS NULL)
            ORDER BY created_at ASC
            """
        )
        return [dict(r) for r in cur.fetchall()]


def fetch_tools(conn, server_id: str) -> list[dict]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT name, description FROM tools WHERE server_id = %s",
            (server_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def save_embedding(conn, server_id: str, embedding: list[float]) -> None:
    vec_str = "[" + ",".join(str(x) for x in embedding) + "]"
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE servers SET embedding = %s::vector WHERE id = %s",
            (vec_str, server_id),
        )
    conn.commit()


def main() -> dict:
    dry_run = "--dry-run" in sys.argv

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    conn = psycopg2.connect(DATABASE_URL)
    pending = fetch_pending(conn)
    total   = len(pending)

    if total == 0:
        log.info("All servers already have embeddings.")
        conn.close()
        return {"embedded": 0, "skipped": 0, "errors": 0}

    est_cost = total * AVG_TOKENS * COST_PER_TOKEN
    print(
        f"Approx cost: ${est_cost:.4f} "
        f"({total} servers × ~{AVG_TOKENS} tokens × $0.02/1M tokens)"
    )

    if dry_run:
        print(f"Dry run — would embed {total} servers. Exiting.")
        conn.close()
        return {"embedded": 0, "skipped": total, "errors": 0}

    client   = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    embedded = 0
    errors   = 0

    for batch_start in range(0, total, BATCH_SIZE):
        batch = pending[batch_start : batch_start + BATCH_SIZE]

        for server in batch:
            tools = fetch_tools(conn, server["id"])
            text  = build_text(server, tools)

            try:
                response  = client.embeddings.create(
                    model="text-embedding-3-small",
                    input=text,
                )
                embedding = response.data[0].embedding
                save_embedding(conn, server["id"], embedding)
                embedded += 1
                print(
                    f"Embedded {embedded}/{total} — {server['name']}"
                )
            except Exception as exc:
                errors += 1
                log.error("Failed to embed %s: %s", server["name"], exc)

        if batch_start + BATCH_SIZE < total:
            time.sleep(SLEEP_SECS)

    conn.close()
    log.info(
        "Done — embedded:%d errors:%d", embedded, errors
    )
    return {"embedded": embedded, "skipped": 0, "errors": errors}


if __name__ == "__main__":
    main()
