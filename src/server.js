require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/database');
const { startCronJob, stopCronJob } = require('./jobs/cronJob');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();

  const server = app.listen(PORT, () => {
    logger.info(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  });

  startCronJob();

  // ─── Graceful Shutdown ────────────────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info(`${signal} received. Starting graceful shutdown...`);
    stopCronJob();

    server.close(async () => {
      logger.info('HTTP server closed.');
      const mongoose = require('mongoose');
      await mongoose.connection.close();
      logger.info('MongoDB connection closed.');
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      logger.error('Forceful shutdown after timeout.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (err) => {
    logger.error(`Unhandled Rejection: ${err.message}`);
    shutdown('unhandledRejection');
  });
};

startServer();
