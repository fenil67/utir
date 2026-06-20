"""
Nightly scheduler for the utir pipeline.

Usage:
    python cron.py            # start the scheduler (runs pipeline at 02:00 daily)
    python cron.py --run-now  # trigger pipeline immediately, then exit
"""

import argparse
import logging
import logging.handlers
import os
import sys
import time
from pathlib import Path

import schedule
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

load_dotenv(ROOT / ".env")

LOGS_DIR  = Path(__file__).parent / "logs"
LOG_FILE  = LOGS_DIR / "pipeline.log"
RUN_TIME  = os.environ.get("PIPELINE_RUN_TIME", "02:00")

LOGS_DIR.mkdir(parents=True, exist_ok=True)


# ── logging setup ─────────────────────────────────────────────────────────────

def setup_logging():
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")

    # Rotating file handler — keeps 7 days of daily logs
    file_handler = logging.handlers.TimedRotatingFileHandler(
        LOG_FILE,
        when="midnight",
        backupCount=7,
        encoding="utf-8",
    )
    file_handler.setFormatter(fmt)

    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(fmt)

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(file_handler)
    root.addHandler(console_handler)


log = logging.getLogger("cron")


# ── job ───────────────────────────────────────────────────────────────────────

def run_pipeline_job():
    log.info("Scheduled pipeline triggered.")
    try:
        from pipeline import run_pipeline
        summary = run_pipeline()
        log.info("Pipeline job finished. Summary: %s", summary.get("totals", {}))
    except Exception as e:
        log.error("Pipeline job failed: %s", e, exc_info=True)


# ── entry point ───────────────────────────────────────────────────────────────

def main():
    setup_logging()

    parser = argparse.ArgumentParser(description="utir nightly pipeline scheduler.")
    parser.add_argument(
        "--run-now",
        action="store_true",
        help="Trigger the pipeline immediately and exit.",
    )
    args = parser.parse_args()

    if args.run_now:
        log.info("--run-now: triggering pipeline immediately.")
        run_pipeline_job()
        return

    # Schedule daily run
    schedule.every().day.at(RUN_TIME).do(run_pipeline_job)
    log.info("Scheduler started. Pipeline will run daily at %s.", RUN_TIME)
    log.info("Logs: %s (7-day rotation)", LOG_FILE)

    try:
        while True:
            schedule.run_pending()
            time.sleep(30)
    except KeyboardInterrupt:
        log.info("Scheduler stopped.")


if __name__ == "__main__":
    main()
