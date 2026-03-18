#!/usr/bin/env node
import { startServer } from './server/server.js';

// Prevent unhandled rejections from crashing the server
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[gws-mcp] unhandled rejection: ${reason}\n`);
});

process.on('uncaughtException', (err) => {
  process.stderr.write(`[gws-mcp] uncaught exception: ${err.message}\n${err.stack}\n`);
});

startServer().catch((err) => {
  process.stderr.write(`[gws-mcp] fatal: ${err.message}\n`);
  process.exit(1);
});
