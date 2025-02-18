#!/usr/bin/env node

import { GSuiteServer } from '../tools/server.js';
import logger from '../utils/logger.js';

async function checkHealth() {
  try {
    const server = new GSuiteServer();
    
    // Attempt to start server
    await server.run();
    
    // If we get here without errors, consider it healthy
    logger.info('Health check passed');
    process.exit(0);
  } catch (error) {
    logger.error('Health check failed:', error);
    process.exit(1);
  }
}

checkHealth().catch(error => {
  logger.error('Fatal error during health check:', error);
  process.exit(1);
});
