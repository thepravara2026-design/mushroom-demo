const db = require("../config/db");
const logger = require("../utils/logger");

let boss = null;
let inMemoryQueue = null;

const QUEUES = {
  ORDER_PROCESSING: "order-processing",
  REFUND_PROCESSING: "refund-processing",
  NOTIFICATION_DISPATCH: "notification-dispatch",
  STOCK_OPERATIONS: "stock-operations",
};

async function startQueue() {
  if (db.isMock) {
    inMemoryQueue = new Map();
    logger.info("[QueueService] Using in-memory queue (mock mode)");
    return;
  }
  try {
    const PgBoss = require("pg-boss");
    const supabaseUrl = process.env.SUPABASE_URL || "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const ref = supabaseUrl.match(/https:\/\/(.+)\.supabase\.co/)?.[1];
    if (!ref || !serviceKey) {
      inMemoryQueue = new Map();
      logger.warn("[QueueService] No Supabase URL/Key — falling back to in-memory queue");
      return;
    }
    boss = new PgBoss({
      host: `db.${ref}.supabase.co`,
      port: 5432,
      database: "postgres",
      user: "postgres",
      password: serviceKey,
      ssl: { rejectUnauthorized: false },
      schema: "pgboss_queue",
    });

    boss.on("error", (err) => logger.error(`[QueueService] pg-boss error: ${err.message}`));

    await boss.start();
    for (const name of Object.values(QUEUES)) {
      await boss.createQueue(name);
    }
    logger.info("[QueueService] pg-boss started successfully");
  } catch (err) {
    inMemoryQueue = new Map();
    logger.warn(`[QueueService] Failed to start pg-boss, using in-memory fallback: ${err.message}`);
  }
}

async function stopQueue() {
  if (boss) {
    await boss.stop();
    boss = null;
  }
  inMemoryQueue = null;
}

async function send(queueName, data, options = {}) {
  if (boss) {
    return boss.send(queueName, data, {
      retryLimit: options.retryLimit || 3,
      retryDelay: options.retryDelay || 5,
      priority: options.priority || 0,
      singletonKey: options.singletonKey || null,
      startAfter: options.startAfter || null,
    });
  }

  // In-memory fallback
  if (!inMemoryQueue) inMemoryQueue = new Map();
  if (!inMemoryQueue.has(queueName)) inMemoryQueue.set(queueName, []);
  const job = { id: `job-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`, data, options };
  inMemoryQueue.get(queueName).push(job);

  setImmediate(() => processInMemoryQueue(queueName));
  return job.id;
}

async function processInMemoryQueue(queueName) {
  if (!inMemoryQueue || !inMemoryQueue.has(queueName)) return;
  const jobs = inMemoryQueue.get(queueName);
  while (jobs.length > 0) {
    const job = jobs.shift();
    const handler = inMemoryHandlers.get(queueName);
    if (handler) {
      try {
        await handler(job);
      } catch (err) {
        logger.error(`[QueueService] In-memory handler failed for ${queueName} job ${job.id}: ${err.message}`);
      }
    }
  }
}

const inMemoryHandlers = new Map();

function work(queueName, handler) {
  if (boss) {
    return boss.work(queueName, async (job) => {
      try {
        await handler(job);
      } catch (err) {
        logger.error(`[QueueService] Handler failed for ${queueName} job ${job.id}: ${err.message}`);
        throw err;
      }
    });
  }
  inMemoryHandlers.set(queueName, handler);
}

async function cancel(jobId) {
  if (boss) {
    return boss.cancel(jobId);
  }
}

module.exports = {
  QUEUES,
  startQueue,
  stopQueue,
  send,
  work,
  cancel,
  get isReady() { return boss !== null || inMemoryQueue !== null; },
};
