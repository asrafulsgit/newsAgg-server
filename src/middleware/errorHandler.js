const logger = require('../utils/logger');

const notFound = (req, res, next) => {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.status = 404;
  next(error);
};

const errorHandler = (err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  if (status >= 500) {
    logger.error(`${status} - ${message} - ${req.originalUrl} - ${req.method}`, {
      stack: err.stack,
    });
  } else {
    logger.warn(`${status} - ${message} - ${req.originalUrl} - ${req.method}`);
  }

  res.status(status).json({
    success: false,
    message: process.env.NODE_ENV === 'production' && status === 500
      ? 'Internal Server Error'
      : message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
};

module.exports = { notFound, errorHandler };
