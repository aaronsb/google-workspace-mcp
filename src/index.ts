#!/usr/bin/env node
import { GSuiteServer } from './tools/server.js';

// Start server with proper shutdown handling
const server = new GSuiteServer();

// Handle process signals
process.on('SIGINT', () => {
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});

// Start with error handling
server.run().catch(error => {
  console.error('Fatal Error:', error);
  process.exit(1);
});
