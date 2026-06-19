"""
Full pipeline orchestrator.

Runs in order:
  1. crawler/github_crawler.py  — find new MCP server repos
  2. classifier/detector.py     — classify + extract tools
  3. scanner/static_scan.py     — security scan + trust score

Each step's result is written to the pipeline_runs table.
After all steps complete, a summary is POSTed to the API.
"""

import logging
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import psycopg2
import psycopg2.extras
import requests
from dotenv import load_dotenv

# ── path setup so we can import sibling packages ──────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

load_dotenv(ROOT / ".env")

DATABASE_URL = os.environ["DATABASE_URL"]
API_BASE      = os.getenv("API_URL", "http://localhost:3001")

log = logging.getLogger("pipeline")


# ── database setup ────────────────────────────────────────────────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at          TIMESTAMP DEFAULT NOW(),
  step            TEXT,
  status          TEXT,
  new_servers     INTEGER DEFAULT 0,
  classified      INTEGER DEFAULT 0,
  confirmed       INTEGER DEFAULT 0,
  scanned         INTEGER DEFAULT 0,
  errors          INTEGER DEFAULT 0,
  duration_secs   INTEGER,
  notes           TEXT
);
"""

def ensure_table(conn):
    with conn.cursor() as cur:
        cur.execute(SCHEMA_SQL)
    conn.commit()


def log_run(conn, step: str, status: str, duration_secs: int,
            result: dict, notes: str = ""):
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO pipeline_runs
              (step, status, new_servers, classified, confirmed,
               scanned, errors, duration_secs, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                step,
                status,
                result.get("new", 0),
                result.get("classified", 0),
                result.get("confirmed", 0),
                result.get("scanned", 0),
                result.get("errors", 0),
                duration_secs,
                notes,
            ),
        )
    conn.commit()


# ── individual steps ──────────────────────────────────────────────────────────

def run_step(conn, step_name: str, fn) -> dict:
    """
    Run a single pipeline step function, measure duration, persist to DB.
    Always returns a summary dict (empty on failure).
    """
    log.info("── Step: %s ──────────────────────────", step_name)
    start = time.monotonic()
    result: dict = {}
    status = "ok"
    notes = ""

    try:
        result = fn() or {}
        log.info("%s finished: %s", step_name, result)
    except Exception as exc:
        status = "error"
        notes = str(exc)
        log.error("%s failed: %s", step_name, exc, exc_info=True)

    duration = int(time.monotonic() - start)
    log.info("%s duration: %ds", step_name, duration)

    try:
        log_run(conn, step_name, status, duration, result, notes)
    except Exception as db_err:
        log.error("Failed to log run for %s: %s", step_name, db_err)

    return result


# ── post-pipeline notification ────────────────────────────────────────────────

def notify_api(summary: dict):
    try:
        resp = requests.post(
            f"{API_BASE}/api/admin/pipeline-complete",
            json=summary,
            timeout=10,
        )
        if resp.ok:
            log.info("API notified successfully.")
        else:
            log.warning("API notification returned %s: %s", resp.status_code, resp.text)
    except Exception as e:
        log.warning("Could not notify API: %s", e)


# ── main pipeline ─────────────────────────────────────────────────────────────

def run_pipeline() -> dict:
    """
    Execute the full pipeline. Returns an overall summary dict.
    Errors in individual steps never abort subsequent steps.
    """
    pipeline_start = datetime.utcnow()
    log.info("Pipeline started at %s", pipeline_start.isoformat())

    conn = psycopg2.connect(DATABASE_URL)
    try:
        ensure_table(conn)
    except Exception as e:
        log.error("Could not ensure pipeline_runs table: %s", e)
        conn.close()
        raise

    # Lazy imports — done here so import errors don't crash cron.py at startup
    try:
        from crawler.github_crawler import main as crawl_main
    except ImportError as e:
        log.error("Cannot import crawler: %s", e)
        crawl_main = lambda: {"new": 0, "skipped": 0, "errors": 1}  # noqa: E731

    try:
        from classifier.detector import main as classify_main
    except ImportError as e:
        log.error("Cannot import classifier: %s", e)
        classify_main = lambda: {"classified": 0, "confirmed": 0, "errors": 1}  # noqa: E731

    try:
        from scanner.static_scan import main as scan_main
    except ImportError as e:
        log.error("Cannot import scanner: %s", e)
        scan_main = lambda: {"scanned": 0, "skipped": 0, "errors": 1}  # noqa: E731

    crawl_result    = run_step(conn, "crawl",    crawl_main)
    classify_result = run_step(conn, "classify", classify_main)
    scan_result     = run_step(conn, "scan",     scan_main)

    conn.close()

    pipeline_end = datetime.utcnow()
    duration_secs = int((pipeline_end - pipeline_start).total_seconds())

    summary = {
        "run_at":        pipeline_start.isoformat(),
        "duration_secs": duration_secs,
        "crawl":         crawl_result,
        "classify":      classify_result,
        "scan":          scan_result,
        "totals": {
            "new_servers": crawl_result.get("new", 0),
            "classified":  classify_result.get("classified", 0),
            "confirmed":   classify_result.get("confirmed", 0),
            "scanned":     scan_result.get("scanned", 0),
            "errors": (
                crawl_result.get("errors", 0)
                + classify_result.get("errors", 0)
                + scan_result.get("errors", 0)
            ),
        },
    }

    log.info(
        "Pipeline complete in %ds — new:%d classified:%d confirmed:%d scanned:%d errors:%d",
        duration_secs,
        summary["totals"]["new_servers"],
        summary["totals"]["classified"],
        summary["totals"]["confirmed"],
        summary["totals"]["scanned"],
        summary["totals"]["errors"],
    )

    notify_api(summary)
    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s")
    run_pipeline()
