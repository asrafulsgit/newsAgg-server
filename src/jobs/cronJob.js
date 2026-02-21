const cron = require('node-cron');
const { ingestNews } = require('../services/newsService');
const logger = require('../utils/logger');

let task = null;
let isRunning = false;

const startCronJob = () => {
  const schedule = process.env.CRON_SCHEDULE || '0 */1 * * *';

  if (!cron.validate(schedule)) {
    logger.error(`Invalid cron schedule: "${schedule}". Using default.`);
    return;
  }

  task = cron.schedule(schedule, async () => {
    if (isRunning) {
      logger.warn('Ingestion already in progress. Skipping this run.');
      return;
    }

    isRunning = true;
    logger.info(`Cron triggered at ${new Date().toISOString()}`);

    try {
      await ingestNews();
    } catch (err) {
      logger.error(`Cron job failed: ${err.message}`);
    } finally {
      isRunning = false;
    }
  });

  logger.info(`Cron job scheduled with pattern: "${schedule}"`);

  // Run immediately on startup in production
  if (process.env.NODE_ENV === 'production' || process.env.FETCH_ON_START === 'true') {
    logger.info('Running initial ingestion on startup...');
    isRunning = true;
    ingestNews()
      .catch((err) => logger.error(`Initial ingestion failed: ${err.message}`))
      .finally(() => { isRunning = false; });
  }
};

const stopCronJob = () => {
  if (task) {
    task.stop();
    logger.info('Cron job stopped.');
  }
};

const triggerManualIngestion = async () => {
  if (isRunning) {
    throw new Error('Ingestion already in progress');
  }
  isRunning = true;
  try {
    return await ingestNews();
  } finally {
    isRunning = false;
  }
};

module.exports = { startCronJob, stopCronJob, triggerManualIngestion };
