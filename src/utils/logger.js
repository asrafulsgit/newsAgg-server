const { createLogger, format, transports } = require('winston');
const path = require('path');

const { combine, timestamp, errors, json, colorize, printf } = format;

const devFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}]: ${stack || message}`;
});

const logger = createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    process.env.NODE_ENV === 'production' ? json() : combine(colorize(), devFormat)
  ),
  transports: [
    new transports.Console(),
    ...(process.env.NODE_ENV === 'production'
      ? [
          new transports.File({ filename: path.join('logs', 'error.log'), level: 'error' }),
          new transports.File({ filename: path.join('logs', 'combined.log') }),
        ]
      : []),
  ],
});

module.exports = logger;
