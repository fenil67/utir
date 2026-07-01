# utir — MCP server trust registry

## Project Path in my Mac Local Machine
/Users/fenilpatel/Documents/Documents - Fenil’s MacBook Pro/Projects/utir

## what this project is
A platform that crawls GitHub/npm for MCP servers, scans them for
security issues, checks their auth implementation, and produces a
trust score 0-100. Developers use it to find safe MCP servers.
Built by Fenil Shah / Utir (utir.dev).

## repo structure
- crawler/     Python — finds MCP servers from GitHub API, npm, registries
- classifier/  Python — confirms a repo is actually an MCP server
- scanner/     Python — security scanning pipeline (semgrep, bandit, docker sandbox)
- api/         Node.js/Express — REST API serving the registry data
- web/         Next.js 15 — public registry UI + publisher dashboard
- monitor/     Python/LangGraph — nightly re-scan agent

## tech stack
- Python 3.11+ for crawler, classifier, scanner, monitor
- Node.js 20 + Express for API
- Next.js 15 + Tailwind for frontend
- PostgreSQL + pgvector for storage and semantic search
- Redis + BullMQ for job queue
- Docker for sandbox scanning

## environment variables (see .env.example)
GITHUB_TOKEN=          # GitHub PAT for API crawling
DATABASE_URL=          # postgres connection string
REDIS_URL=             # redis connection string
OPENAI_API_KEY=        # for generating embeddings
ANTHROPIC_API_KEY=     # for injection scan LLM check

## build order
1. crawler/github_crawler.py
2. classifier/detector.py
3. api/db/schema.sql
4. api/index.js + routes
5. scanner/
6. web/
7. monitor/

## current focus
Building the crawler first. Goal: pull all repos tagged
topic:mcp-server from GitHub API and store in postgres.

## commands
make crawl     # run the crawler
make scan      # run scanner on unscanned servers
make api       # start the API server
make web       # start the Next.js dev server
make db        # run schema migrations