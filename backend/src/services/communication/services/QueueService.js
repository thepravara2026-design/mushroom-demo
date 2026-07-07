const crypto = require("crypto");
const config = require("../config");
const commLogger = require("../logs");

const jobQueues = new Map();
let processing = false;

class QueueService {
  static enqueue(jobType, data, options = {}) {
    const id = `comm_job_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const job = {
      id,
      type: jobType,
      data: { ...data },
      status: "queued",
      retries: 0,
      maxRetries: options.maxRetries || config.queue.retryMaxAttempts,
      priority: options.priority || 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: null,
    };

    if (!jobQueues.has(jobType)) {
      jobQueues.set(jobType, []);
    }
    jobQueues.get(jobType).push(job);

    commLogger.info(`[CommQueue] Job enqueued: ${id} (${jobType})`);
    QueueService._processQueue();

    return id;
  }

  static async processJob(jobType, handler) {
    const handlers = QueueService._getHandlers();
    handlers.set(jobType, handler);
    QueueService._processQueue();
  }

  static _getHandlers() {
    if (!global.__commQueueHandlers) {
      global.__commQueueHandlers = new Map();
    }
    return global.__commQueueHandlers;
  }

  static async _processQueue() {
    if (processing) return;
    processing = true;

    try {
      const handlers = QueueService._getHandlers();
      const allTypes = [...new Set([...jobQueues.keys(), ...handlers.keys()])];

      for (const jobType of allTypes) {
        const handler = handlers.get(jobType);
        if (!handler) continue;

        const queue = jobQueues.get(jobType) || [];
        const pendingJobs = queue.filter((j) => j.status === "queued");

        for (const job of pendingJobs) {
          try {
            job.status = "processing";
            job.updatedAt = new Date().toISOString();

            await handler(job);

            job.status = "completed";
            job.updatedAt = new Date().toISOString();
            commLogger.info(`[CommQueue] Job completed: ${job.id} (${jobType})`);
          } catch (err) {
            job.retries += 1;
            job.error = err.message;
            job.updatedAt = new Date().toISOString();

            if (job.retries >= job.maxRetries) {
              job.status = "failed";
              commLogger.error(`[CommQueue] Job failed (max retries): ${job.id} (${jobType}): ${err.message}`);
            } else {
              job.status = "queued";
              const delay = config.queue.retryBaseDelayMs * Math.pow(2, job.retries - 1);
              commLogger.warn(`[CommQueue] Job will retry: ${job.id} (${jobType}) attempt ${job.retries}/${job.maxRetries} in ${delay}ms`);
              QueueService._scheduleRetry(job, delay);
            }
          }
        }
      }
    } finally {
      processing = false;
    }
  }

  static _scheduleRetry(job, delayMs) {
    setTimeout(() => {
      QueueService._processQueue();
    }, delayMs);
  }

  static getJob(jobId) {
    for (const [, queue] of jobQueues) {
      const job = queue.find((j) => j.id === jobId);
      if (job) return { ...job };
    }
    return null;
  }

  static getQueueStatus() {
    const status = {};
    for (const [type, queue] of jobQueues) {
      status[type] = {
        total: queue.length,
        queued: queue.filter((j) => j.status === "queued").length,
        processing: queue.filter((j) => j.status === "processing").length,
        completed: queue.filter((j) => j.status === "completed").length,
        failed: queue.filter((j) => j.status === "failed").length,
      };
    }
    return status;
  }

  static retryFailedJobs() {
    let retried = 0;
    for (const [, queue] of jobQueues) {
      for (const job of queue) {
        if (job.status === "failed") {
          job.status = "queued";
          job.retries = 0;
          job.error = null;
          job.updatedAt = new Date().toISOString();
          retried++;
        }
      }
    }
    if (retried > 0) {
      commLogger.info(`[CommQueue] Retrying ${retried} failed jobs`);
      QueueService._processQueue();
    }
    return retried;
  }

  static retryJob(jobId) {
    for (const [, queue] of jobQueues) {
      const job = queue.find((j) => j.id === jobId);
      if (job && job.status === "failed") {
        job.status = "queued";
        job.retries = 0;
        job.error = null;
        job.updatedAt = new Date().toISOString();
        commLogger.info(`[CommQueue] Retrying job: ${jobId}`);
        QueueService._processQueue();
        return true;
      }
    }
    return false;
  }

  static getStats() {
    let total = 0;
    let queued = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;

    for (const [, queue] of jobQueues) {
      total += queue.length;
      queued += queue.filter((j) => j.status === "queued").length;
      processing += queue.filter((j) => j.status === "processing").length;
      completed += queue.filter((j) => j.status === "completed").length;
      failed += queue.filter((j) => j.status === "failed").length;
    }

    return { total, queued, processing, completed, failed };
  }
}

module.exports = QueueService;
