#!/usr/bin/env node
import { startServer } from './server/server.js';

startServer().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
