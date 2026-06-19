# utir security findings — MCP ecosystem scan

**Date:** June 2026  
**Servers scanned:** 661  
**Source:** GitHub topic:mcp-server + npm registry

## headline numbers

- 78% of MCP servers have significant security issues (trust score below 60)
- 85 servers (13%) have zero authentication on remote endpoints (Tier F)
- Average trust score across the ecosystem: 49/100
- Only 12 servers score 80 or above — production safe
- 445 servers claim OAuth/token auth but many are unverified in code

## by language

- Python: 300 servers — most common, most findings from bandit
- TypeScript: 256 servers — cleaner on average
- JavaScript: 53 servers
- Go: 8 servers — highest avg score (Go has no bandit equivalent so fewer flags)

## score distribution

- 80-100 (production safe): 12 servers (1.8%)
- 60-79 (review before using): 234 servers (35%)
- 30-59 (dev/test only): 365 servers (55%)
- 0-29 (do not install): 50 servers (7.5%)

## what we found

- Unsafe command execution patterns in X% of servers
- SSRF-vulnerable HTTP calls in X% of servers  
- Hardcoded credentials detected in X servers
- Dependency vulnerabilities: 271 known CVEs flagged across majority
  (most from a single commonly used vulnerable package)
- Tool description injection patterns in X servers

## notable findings

- github/github-mcp-server: 85/100 — best in class, 30k stars
- [lowest scoring notable server]: X/100 — reason

## methodology

Servers were scanned using:
- Bandit (Python static analysis)
- Custom pattern matching for TypeScript/JavaScript
- npm audit / pip-audit for dependency CVEs
- Auth detection via source code analysis
- Docker sandbox behavioral testing (coming in v2)

Full scanner source: github.com/[your-handle]/utir