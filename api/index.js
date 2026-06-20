'use strict';

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const { Pool }   = require('pg');
const { OpenAI } = require('openai');
const queries    = require('./db/queries');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── database pool ─────────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (err) => {
  console.error('Unexpected DB pool error:', err.message);
});

// ── app setup ─────────────────────────────────────────────────────────────────

const app = express();

app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());

// Rate limiting: 100 requests per 15 minutes per IP
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
}));

// ── helpers ───────────────────────────────────────────────────────────────────

const GITHUB_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/;

/** Wrap async route handlers so unhandled rejections reach the error middleware. */
const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ── routes ────────────────────────────────────────────────────────────────────

// GET /health
app.get('/health', asyncHandler(async (_req, res) => {
  const count = await queries.countServers(pool);
  res.json({ status: 'ok', servers: count });
}));

// GET /api/servers
app.get('/api/servers', asyncHandler(async (req, res) => {
  const { page, limit, sort, min_score, max_score, auth_tier, language } = req.query;

  const { rows, total } = await queries.listServers(pool, {
    page, limit, sort, min_score, max_score, auth_tier, language,
  });

  const pageNum  = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

  res.json({
    data: rows,
    pagination: {
      page:        pageNum,
      limit:       limitNum,
      total,
      total_pages: Math.ceil(total / limitNum),
    },
  });
}));

// GET /api/servers/:id
app.get('/api/servers/:id', asyncHandler(async (req, res) => {
  // Basic UUID format check to avoid pointless DB round-trips
  const { id } = req.params;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: 'Invalid server ID format.' });
  }

  const server = await queries.getServer(pool, id);
  if (!server) {
    return res.status(404).json({ error: 'Server not found.' });
  }

  res.json({ data: server });
}));

// GET /api/search?q=
app.get('/api/search', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    return res.status(400).json({ error: 'Query parameter "q" is required.' });
  }
  if (q.length > 200) {
    return res.status(400).json({ error: 'Query too long (max 200 characters).' });
  }

  // Try to get a query embedding for semantic search; fall back to text search on failure
  let queryEmbedding = null;
  if (process.env.OPENAI_API_KEY) {
    try {
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: q,
      });
      queryEmbedding = response.data[0].embedding;
    } catch (err) {
      console.warn('OpenAI embedding failed, falling back to text search:', err.message);
    }
  }

  const results = await queries.searchServers(pool, q, queryEmbedding);

  // Log search asynchronously — don't block the response
  queries.recordSearchQuery(pool, { query: q, results: results.length })
    .catch((err) => console.warn('Failed to log search query:', err.message));

  res.json({
    data:    results,
    query:   q,
    mode:    queryEmbedding ? 'semantic' : 'text',
  });
}));

// GET /api/stats
app.get('/api/stats', asyncHandler(async (_req, res) => {
  const stats = await queries.getStats(pool);
  res.json({ data: stats });
}));

// POST /api/submit
app.post('/api/submit', asyncHandler(async (req, res) => {
  const { github_url } = req.body || {};

  if (!github_url || typeof github_url !== 'string') {
    return res.status(400).json({ error: '"github_url" is required.' });
  }

  const url = github_url.trim().replace(/\.git$/, '');

  if (!GITHUB_URL_RE.test(url)) {
    return res.status(400).json({
      error: 'Must be a valid GitHub repository URL (https://github.com/owner/repo).',
    });
  }

  const existing = await queries.findByGithubUrl(pool, url);
  if (existing) {
    return res.status(409).json({
      message: 'Repository already in the registry.',
      id:      existing.id,
      status:  existing.confirmed ? 'confirmed' : 'queued',
    });
  }

  const id = await queries.insertServer(pool, url);
  res.status(201).json({
    message: 'Repository queued for scanning.',
    id,
    status: 'queued',
  });
}));

// ── publisher / dashboard routes ─────────────────────────────────────────────

const crypto = require('crypto');

// POST /api/claim  { github_url, clerk_user_id, clerk_email?, github_username }
app.post('/api/claim', asyncHandler(async (req, res) => {
  const { github_url, clerk_user_id, github_username } = req.body || {};

  if (!github_url || typeof github_url !== 'string') {
    return res.status(400).json({ error: '"github_url" is required.' });
  }
  if (!clerk_user_id || typeof clerk_user_id !== 'string') {
    return res.status(400).json({ error: '"clerk_user_id" is required.' });
  }

  // Ownership checks — both must pass before any DB work
  if (!github_username) {
    return res.status(403).json({
      error: 'GitHub account not connected. Please connect your GitHub account in profile settings before claiming a server.',
    });
  }

  const url = github_url.trim().replace(/\.git$/, '');
  if (!GITHUB_URL_RE.test(url)) {
    return res.status(400).json({ error: 'Must be a valid GitHub repository URL.' });
  }

  const urlOwner    = new URL(url).pathname.split('/')[1].toLowerCase();
  const claimingUser = github_username.toLowerCase();

  if (urlOwner !== claimingUser) {
    return res.status(403).json({
      error: `Ownership verification failed. The repo belongs to "${urlOwner}" but your GitHub username is "${claimingUser}". You can only claim servers from your own GitHub account.`,
    });
  }

  // Ensure the server row exists — it may not be in the DB yet if claim races submit
  const existing = await queries.findByGithubUrl(pool, url);
  if (!existing) {
    await queries.insertServer(pool, url);
  }

  const server = await queries.claimServer(pool, url, clerk_user_id);
  if (!server) {
    return res.status(409).json({ error: 'This server is already claimed by another account.' });
  }

  res.json({ data: server });
}));

// GET /api/dashboard/:clerk_user_id
app.get('/api/dashboard/:clerk_user_id', asyncHandler(async (req, res) => {
  const { clerk_user_id } = req.params;
  if (!clerk_user_id) {
    return res.status(400).json({ error: 'clerk_user_id is required.' });
  }

  const data = await queries.getDashboardData(pool, clerk_user_id);
  res.json({ data });
}));

// POST /api/dashboard/install-event  { server_id }
app.post('/api/dashboard/install-event', asyncHandler(async (req, res) => {
  const { server_id } = req.body || {};

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!server_id || !UUID_RE.test(server_id)) {
    return res.status(400).json({ error: 'Valid "server_id" UUID is required.' });
  }

  await queries.recordInstallEvent(pool, server_id);
  res.status(201).json({ ok: true });
}));

// ── admin routes ──────────────────────────────────────────────────────────────

function requireAdminKey(req, res, next) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    return res.status(503).json({ error: 'Admin key not configured on server.' });
  }
  if (req.headers['x-admin-key'] !== adminKey) {
    return res.status(401).json({ error: 'Invalid or missing X-Admin-Key header.' });
  }
  next();
}

// POST /api/admin/pipeline-complete
app.post('/api/admin/pipeline-complete', requireAdminKey, asyncHandler(async (req, res) => {
  const summary = req.body;
  if (!summary || typeof summary !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object.' });
  }
  await queries.insertPipelineRun(pool, summary);
  res.status(201).json({ message: 'Pipeline run recorded.' });
}));

// GET /api/admin/pipeline-runs
app.get('/api/admin/pipeline-runs', requireAdminKey, asyncHandler(async (_req, res) => {
  const runs = await queries.listPipelineRuns(pool);
  res.json({ data: runs });
}));

// GET /api/admin/monitor/events?severity=
app.get('/api/admin/monitor/events', requireAdminKey, asyncHandler(async (req, res) => {
  const { severity } = req.query;
  const events = await queries.getMonitorEvents(pool, { severity });
  res.json({ data: events });
}));

// POST /api/admin/monitor/events/:id/acknowledge
app.post('/api/admin/monitor/events/:id/acknowledge', requireAdminKey, asyncHandler(async (req, res) => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid event ID.' });
  }
  await queries.acknowledgeMonitorEvent(pool, req.params.id);
  res.json({ ok: true });
}));

// POST /api/admin/run-pipeline  — pipeline runs in the scheduler container
app.post('/api/admin/run-pipeline', requireAdminKey, asyncHandler(async (_req, res) => {
  res.json({ message: 'Pipeline runs automatically at 02:00 UTC daily via the scheduler service. To trigger manually, use: railway run --service utir-scheduler python cron.py --run-now' });
}));

// POST /api/admin/run-monitor  — monitor runs in the scheduler container
app.post('/api/admin/run-monitor', requireAdminKey, asyncHandler(async (_req, res) => {
  res.json({ message: 'Pipeline runs automatically at 02:00 UTC daily via the scheduler service. To trigger manually, use: railway run --service utir-scheduler python cron.py --run-now' });
}));

// ── analytics routes ──────────────────────────────────────────────────────────

// POST /api/analytics/pageview  — unauthenticated, fire-and-forget from the web app
app.post('/api/analytics/pageview', asyncHandler(async (req, res) => {
  const { path, server_id, referrer, user_agent } = req.body || {};

  if (!path || typeof path !== 'string' || path.length > 500) {
    return res.status(400).json({ error: 'Valid "path" string required.' });
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validServerId = server_id && UUID_RE.test(server_id) ? server_id : null;

  await queries.recordPageView(pool, {
    path:       path.slice(0, 500),
    server_id:  validServerId,
    referrer:   referrer   ? String(referrer).slice(0, 1000)   : null,
    user_agent: user_agent ? String(user_agent).slice(0, 500)  : null,
    country:    req.headers['cf-ipcountry'] || null,
  });

  res.status(201).json({ ok: true });
}));

// GET /api/admin/analytics/overview
app.get('/api/admin/analytics/overview', requireAdminKey, asyncHandler(async (_req, res) => {
  const data = await queries.getAnalyticsOverview(pool);
  res.json({ data });
}));

// GET /api/admin/analytics/searches
app.get('/api/admin/analytics/searches', requireAdminKey, asyncHandler(async (_req, res) => {
  const data = await queries.getRecentSearches(pool);
  res.json({ data });
}));

// GET /api/monitor/events/:server_id  — public, per-server history
app.get('/api/monitor/events/:server_id', asyncHandler(async (req, res) => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(req.params.server_id)) {
    return res.status(400).json({ error: 'Invalid server ID.' });
  }
  const events = await queries.getServerMonitorEvents(pool, req.params.server_id);
  res.json({ data: events });
}));

// ── error handling ────────────────────────────────────────────────────────────

// 404 for unmatched routes
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Central error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ── start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`utir API listening on port ${PORT}`);
});
