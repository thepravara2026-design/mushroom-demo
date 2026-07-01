const db = require("../config/db");
const logger = require("../utils/logger");

let pgPool = null;

async function getPgPool() {
  if (pgPool) return pgPool;
  if (db.isMock) return null;

  try {
    const supabaseUrl = process.env.SUPABASE_URL || "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const ref = supabaseUrl.match(/https:\/\/(.+)\.supabase\.co/)?.[1];
    if (!ref || !serviceKey) return null;

    const { Pool } = require("pg");
    pgPool = new Pool({
      host: `db.${ref}.supabase.co`,
      port: 5432,
      database: "postgres",
      user: "postgres",
      password: serviceKey,
      ssl: { rejectUnauthorized: false },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    return pgPool;
  } catch (err) {
    logger.warn(`[TransactionManager] Failed to create pg pool: ${err.message}`);
    return null;
  }
}

async function getClient() {
  const pool = await getPgPool();
  if (!pool) return null;
  return pool.connect();
}

async function withTransaction(fn) {
  if (db.isMock) {
    return fn(null);
  }

  const client = await getClient();
  if (!client) {
    return fn(null);
  }

  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      logger.error(`[TransactionManager] Rollback failed: ${rollbackErr.message}`);
    }
    throw err;
  } finally {
    try { client.release(); } catch (_) { }
  }
}

async function withRowLock(client, table, id, lockMode = "UPDATE") {
  if (!client) return null;
  const mode = lockMode === "SHARE" ? "FOR SHARE" : "FOR UPDATE";
  const { rows } = await client.query(
    `SELECT * FROM "${table}" WHERE id = $1 ${mode}`,
    [id]
  );
  return rows[0] || null;
}

async function withRowLocks(client, table, ids, lockMode = "UPDATE") {
  if (!client || !ids || ids.length === 0) return [];
  const mode = lockMode === "SHARE" ? "FOR SHARE" : "FOR UPDATE";
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await client.query(
    `SELECT * FROM "${table}" WHERE id IN (${placeholders}) ORDER BY id ${mode}`,
    ids
  );
  return rows;
}

async function withSkipLocked(client, table, statusCondition, limit = 10) {
  if (!client) return [];
  const { rows } = await client.query(
    `SELECT * FROM "${table}" WHERE ${statusCondition} LIMIT $1 FOR UPDATE SKIP LOCKED`,
    [limit]
  );
  return rows;
}

async function optimisticUpdate(client, table, id, updates, expectedVersion) {
  if (!client) {
    if (db.isMock) {
      const store = db._getMockStore ? db._getMockStore() : null;
      if (store && store[table]) {
        const item = store[table].find(i => i.id === id);
        if (!item) return { rowCount: 0, data: null };
        if (item.version !== undefined && expectedVersion !== undefined && item.version !== expectedVersion) {
          const err = new Error(`Optimistic lock conflict on ${table}:${id}. Expected version ${expectedVersion}, current ${item.version}`);
          err.code = "OPTIMISTIC_LOCK_CONFLICT";
          throw err;
        }
        Object.assign(item, updates);
        if (item.version !== undefined) item.version += 1;
        return { rowCount: 1, data: item };
      }
      return { rowCount: 0, data: null };
    }
    return { rowCount: 0, data: null };
  }

  const setClauses = [];
  const values = [];
  let paramIdx = 1;

  for (const [key, val] of Object.entries(updates)) {
    if (key === "version") continue;
    setClauses.push(`"${key}" = $${paramIdx}`);
    values.push(val);
    paramIdx++;
  }

  if (expectedVersion !== undefined) {
    setClauses.push(`version = version + 1`);
  }

  values.push(id);
  const idIdx = paramIdx;
  paramIdx++;

  let whereClause = `id = $${idIdx}`;
  if (expectedVersion !== undefined) {
    whereClause += ` AND version = $${paramIdx}`;
    values.push(expectedVersion);
    paramIdx++;
  }

  const query = `UPDATE "${table}" SET ${setClauses.join(", ")} WHERE ${whereClause}`;
  const result = await client.query(query, values);

  if (result.rowCount === 0 && expectedVersion !== undefined) {
    const { rows: current } = await client.query(
      `SELECT version FROM "${table}" WHERE id = $1`,
      [id]
    );
    if (current.length > 0 && current[0].version !== expectedVersion) {
      const err = new Error(`Optimistic lock conflict on ${table}:${id}. Expected version ${expectedVersion}, current ${current[0].version}`);
      err.code = "OPTIMISTIC_LOCK_CONFLICT";
      err.table = table;
      err.rowId = id;
      err.expectedVersion = expectedVersion;
      err.currentVersion = current[0].version;
      throw err;
    }
  }

  return { rowCount: result.rowCount, data: null };
}

async function closePool() {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
}

module.exports = {
  withTransaction,
  withRowLock,
  withRowLocks,
  withSkipLocked,
  optimisticUpdate,
  getClient,
  closePool,
};
