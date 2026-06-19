.PHONY: crawl classify scan api web db schedule run-now logs

crawl:
	cd crawler && python github_crawler.py

classify:
	cd classifier && python detector.py

scan:
	cd scanner && python static_scan.py

api:
	cd api && node index.js

web:
	cd web && npm run dev

db:
	psql "$(DATABASE_URL)" < api/db/schema.sql

# ── scheduler ─────────────────────────────────────────────────────────────────

schedule:
	@echo "Starting pipeline scheduler in background…"
	@mkdir -p scheduler/logs
	nohup python -m scheduler.cron > scheduler/logs/cron-stdout.log 2>&1 & \
	echo $$! > scheduler/scheduler.pid && \
	echo "Scheduler PID: $$(cat scheduler/scheduler.pid)"

run-now:
	python -m scheduler.cron --run-now

logs:
	tail -f scheduler/logs/pipeline.log
