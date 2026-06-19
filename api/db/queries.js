'use strict';

// ── helpers ───────────────────────────────────────────────────────────────────

const SORT_MAP = {
  score_desc: 'latest.trust_score DESC NULLS LAST',
  score_asc:  'latest.trust_score ASC  NULLS LAST',
  stars_desc: 's.stars DESC',
  newest:     's.created_at DESC',
};

/** Safely coerce a value to a positive integer, falling back to `fallback`. */
function posInt(val, fallback) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ── queries ───────────────────────────────────────────────────────────────────

/**
 * Paginated server list with latest scan data.
 *
 * @param {import('pg').Pool} pool
 * @param {object} opts
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function listServers(pool, {
  page      = 1,
  limit     = 20,
  sort      = 'score_desc',
  min_score,
  max_score,
  auth_tier,
  language,
} = {}) {
  const pageNum  = posInt(page, 1);
  const limitNum = Math.min(posInt(limit, 20), 100);
  const offset   = (pageNum - 1) * limitNum;
  const orderBy  = SORT_MAP[sort] || SORT_MAP.score_desc;

  const conditions = ['s.confirmed = TRUE'];
  const params     = [];

  if (min_score !== undefined) {
    params.push(Number(min_score));
    conditions.push(`latest.trust_score >= $${params.length}`);
  }
  if (max_score !== undefined) {
    params.push(Number(max_score));
    conditions.push(`latest.trust_score <= $${params.length}`);
  }
  if (auth_tier) {
    params.push(auth_tier.toUpperCase());
    conditions.push(`latest.auth_tier = $${params.length}`);
  }
  if (language) {
    params.push(language);
    conditions.push(`s.language ILIKE $${params.length}`);
  }

  const where = conditions.join(' AND ');

  // CTE grabs the most recent scan per server
  const sql = `
    WITH latest AS (
      SELECT DISTINCT ON (server_id)
        server_id,
        trust_score,
        auth_tier,
        static_score,
        deps_score,
        maintenance_score,
        findings,
        scanned_at,
        jsonb_array_length(COALESCE(findings, '[]'::jsonb)) AS findings_count
      FROM scans
      ORDER BY server_id, scanned_at DESC
    )
    SELECT
      s.id,
      s.name,
      s.github_url,
      s.description,
      s.language,
      s.stars,
      s.owner,
      s.topics,
      s.last_pushed,
      s.created_at,
      latest.trust_score,
      latest.auth_tier,
      latest.static_score,
      latest.deps_score,
      latest.maintenance_score,
      latest.findings_count,
      latest.scanned_at AS last_scanned,
      COUNT(*) OVER () AS total_count
    FROM servers s
    LEFT JOIN latest ON latest.server_id = s.id
    WHERE ${where}
    ORDER BY ${orderBy}
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  params.push(limitNum, offset);
  const result = await pool.query(sql, params);

  const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
  const rows  = result.rows.map(({ total_count, ...rest }) => rest); // strip window col
  return { rows, total };
}

/**
 * Full server detail: server row + latest scan findings + tools list.
 *
 * @param {import('pg').Pool} pool
 * @param {string} id  UUID
 */
async function getServer(pool, id) {
  const serverSql = `
    SELECT
      s.id, s.name, s.github_url, s.description, s.language,
      s.stars, s.owner, s.topics, s.last_pushed, s.created_at,
      sc.trust_score, sc.auth_tier, sc.static_score, sc.deps_score,
      sc.behavior_score, sc.maintenance_score, sc.findings,
      sc.raw_output, sc.scanned_at AS last_scanned
    FROM servers s
    LEFT JOIN LATERAL (
      SELECT * FROM scans
      WHERE server_id = s.id
      ORDER BY scanned_at DESC
      LIMIT 1
    ) sc ON TRUE
    WHERE s.id = $1 AND s.confirmed = TRUE
  `;

  const toolsSql = `
    SELECT id, name, description, input_schema
    FROM tools
    WHERE server_id = $1
    ORDER BY name
  `;

  const [serverResult, toolsResult] = await Promise.all([
    pool.query(serverSql, [id]),
    pool.query(toolsSql, [id]),
  ]);

  if (serverResult.rows.length === 0) return null;

  return {
    ...serverResult.rows[0],
    tools: toolsResult.rows,
  };
}

/**
 * Full-text search over name, description, and tool names.
 *
 * @param {import('pg').Pool} pool
 * @param {string} q  raw search string
 */
async function searchServers(pool, q) {
  if (!q || !q.trim()) return [];

  const sql = `
    WITH latest AS (
      SELECT DISTINCT ON (server_id)
        server_id, trust_score, auth_tier, scanned_at
      FROM scans
      ORDER BY server_id, scanned_at DESC
    ),
    tool_names AS (
      SELECT server_id, string_agg(name, ' ') AS names
      FROM tools
      GROUP BY server_id
    )
    SELECT
      s.id,
      s.name,
      s.github_url,
      s.description,
      s.language,
      s.stars,
      s.owner,
      latest.trust_score,
      latest.auth_tier,
      latest.scanned_at AS last_scanned,
      ts_rank(
        to_tsvector('english',
          coalesce(s.name, '') || ' ' ||
          coalesce(s.description, '') || ' ' ||
          coalesce(tn.names, '')
        ),
        plainto_tsquery('english', $1)
      ) AS rank
    FROM servers s
    LEFT JOIN latest   ON latest.server_id = s.id
    LEFT JOIN tool_names tn ON tn.server_id = s.id
    WHERE s.confirmed = TRUE
      AND to_tsvector('english',
            coalesce(s.name, '') || ' ' ||
            coalesce(s.description, '') || ' ' ||
            coalesce(tn.names, '')
          ) @@ plainto_tsquery('english', $1)
    ORDER BY rank DESC
    LIMIT 10
  `;

  const result = await pool.query(sql, [q.trim()]);
  return result.rows;
}

/**
 * Ecosystem stats: counts, averages, distributions.
 *
 * @param {import('pg').Pool} pool
 */
async function getStats(pool) {
  const sql = `
    WITH latest AS (
      SELECT DISTINCT ON (server_id)
        server_id, trust_score, auth_tier
      FROM scans
      ORDER BY server_id, scanned_at DESC
    )
    SELECT
      COUNT(s.id)                                          AS total_servers,
      COUNT(sc.server_id)                                  AS total_scanned,
      ROUND(AVG(sc.trust_score))                           AS avg_score,
      COUNT(*) FILTER (WHERE sc.trust_score >= 70)         AS high_trust,
      COUNT(*) FILTER (WHERE sc.trust_score < 40)          AS low_trust,
      COUNT(*) FILTER (WHERE sc.auth_tier = 'F')           AS tier_f,
      COUNT(*) FILTER (WHERE sc.auth_tier = 'A')           AS tier_a,
      COUNT(*) FILTER (WHERE sc.auth_tier = 'B')           AS tier_b,
      COUNT(*) FILTER (WHERE sc.auth_tier = 'C')           AS tier_c
    FROM servers s
    LEFT JOIN latest sc ON sc.server_id = s.id
    WHERE s.confirmed = TRUE
  `;

  const langSql = `
    SELECT language, COUNT(*) AS count
    FROM servers
    WHERE confirmed = TRUE AND language IS NOT NULL
    GROUP BY language
    ORDER BY count DESC
    LIMIT 10
  `;

  const distSql = `
    WITH latest AS (
      SELECT DISTINCT ON (server_id) trust_score
      FROM scans
      ORDER BY server_id, scanned_at DESC
    )
    SELECT
      CASE
        WHEN trust_score >= 90 THEN '90-100'
        WHEN trust_score >= 70 THEN '70-89'
        WHEN trust_score >= 50 THEN '50-69'
        WHEN trust_score >= 30 THEN '30-49'
        ELSE '0-29'
      END AS range,
      COUNT(*) AS count
    FROM latest
    WHERE trust_score IS NOT NULL
    GROUP BY range
    ORDER BY range DESC
  `;

  const [statsResult, langResult, distResult] = await Promise.all([
    pool.query(sql),
    pool.query(langSql),
    pool.query(distSql),
  ]);

  return {
    ...statsResult.rows[0],
    languages:          langResult.rows,
    score_distribution: distResult.rows,
  };
}

/**
 * Total count of confirmed servers (for /health).
 *
 * @param {import('pg').Pool} pool
 */
async function countServers(pool) {
  const result = await pool.query(
    "SELECT COUNT(*) AS count FROM servers WHERE confirmed = TRUE"
  );
  return parseInt(result.rows[0].count, 10);
}

/**
 * Find a server by its github_url.
 *
 * @param {import('pg').Pool} pool
 * @param {string} githubUrl
 */
async function findByGithubUrl(pool, githubUrl) {
  const result = await pool.query(
    'SELECT id, confirmed, classified FROM servers WHERE github_url = $1',
    [githubUrl]
  );
  return result.rows[0] || null;
}

/**
 * Insert a new server submission.
 *
 * @param {import('pg').Pool} pool
 * @param {string} githubUrl
 * @returns {Promise<string>} new server UUID
 */
async function insertServer(pool, githubUrl) {
  const result = await pool.query(
    `INSERT INTO servers (github_url, confirmed, classified)
     VALUES ($1, FALSE, FALSE)
     RETURNING id`,
    [githubUrl]
  );
  return result.rows[0].id;
}

/**
 * Insert a pipeline run summary row.
 *
 * @param {import('pg').Pool} pool
 * @param {object} summary  — the full JSON body from the scheduler
 */
async function insertPipelineRun(pool, summary) {
  const totals = summary.totals || {};
  await pool.query(
    `INSERT INTO pipeline_runs
       (step, status, new_servers, classified, confirmed, scanned, errors, duration_secs, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      'full_pipeline',
      'ok',
      totals.new_servers   || 0,
      totals.classified    || 0,
      totals.confirmed     || 0,
      totals.scanned       || 0,
      totals.errors        || 0,
      summary.duration_secs || null,
      JSON.stringify({ run_at: summary.run_at, steps: summary }),
    ]
  );
}

/**
 * Return the last 10 pipeline runs, newest first.
 *
 * @param {import('pg').Pool} pool
 */
async function listPipelineRuns(pool) {
  const result = await pool.query(
    `SELECT run_at, step, status, new_servers, classified, confirmed,
            scanned, errors, duration_secs
     FROM pipeline_runs
     ORDER BY run_at DESC
     LIMIT 10`
  );
  return result.rows;
}

module.exports = {
  listServers,
  getServer,
  searchServers,
  getStats,
  countServers,
  findByGithubUrl,
  insertServer,
  insertPipelineRun,
  listPipelineRuns,
};
