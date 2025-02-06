import winston from 'winston';
import path from 'path';

// Get package info without using require
const packageInfo = {
  name: 'GSuite OAuth MCP Server',
  version: '0.1.0'
};

// Create logs directory if it doesn't exist
const logsDir = 'logs';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  defaultMeta: { service: `${packageInfo.name}@${packageInfo.version}` },
  transports: [
    new winston.transports.Console({
      format: winston.format.printf(({ level, message }) => {
        return `${level}: ${message}`;
      }),
      stderrLevels: ['error', 'warn', 'info', 'debug']
    })
  ],
});

// Only add file transports in production
if (process.env.NODE_ENV === 'production') {
  logger.add(new winston.transports.File({ 
    filename: 'logs/error.log', 
    level: 'error' 
  }));
  logger.add(new winston.transports.File({ 
    filename: 'logs/combined.log' 
  }));
}

export default logger;
