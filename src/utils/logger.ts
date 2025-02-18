import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/**
 * Logger utility with configurable logging behavior.
 * 
 * Supports two logging modes:
 * - normal: Uses appropriate console methods for each log level (error, warn, info, debug)
 * - strict: Routes all non-JSON-RPC messages to stderr for compatibility with tools like Claude desktop
 * 
 * Configure via:
 * - LOG_MODE environment variable:
 *   - LOG_MODE=normal (default) - Standard logging behavior
 *   - LOG_MODE=strict - All logs except JSON-RPC go to stderr
 * - LOG_FILE environment variable:
 *   - If set, logs will also be written to this file
 * 
 * For testing: The logger should be mocked in tests to prevent console noise.
 * See src/__helpers__/testSetup.ts for the mock implementation.
 */

type LogMode = 'normal' | 'strict';

const LOG_MODE = (process.env.LOG_MODE || 'normal') as LogMode;
const LOG_FILE = process.env.LOG_FILE;

// Ensure log directory exists if LOG_FILE is set
if (LOG_FILE) {
  const dir = dirname(LOG_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

const isJsonRpc = (msg: any): boolean => {
  if (typeof msg !== 'string') return false;
  return msg.startsWith('{"jsonrpc":') || msg.startsWith('{"id":');
};

const writeToLogFile = (level: string, ...args: any[]) => {
  if (!LOG_FILE) return;
  try {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => 
      typeof arg === 'string' ? arg : JSON.stringify(arg)
    ).join(' ');
    appendFileSync(LOG_FILE, `[${timestamp}] [${level.toUpperCase()}] ${message}\n`);
  } catch (error) {
    console.error('Failed to write to log file:', error);
  }
};

const logger = {
  error: (...args: any[]) => {
    console.error(...args);
    writeToLogFile('error', ...args);
  },
  warn: (...args: any[]) => {
    if (LOG_MODE === 'strict' || isJsonRpc(args[0])) {
      console.error(...args);
    } else {
      console.warn(...args);
    }
    writeToLogFile('warn', ...args);
  },
  info: (...args: any[]) => {
    if (LOG_MODE === 'strict' || isJsonRpc(args[0])) {
      console.error(...args);
    } else {
      console.info(...args);
    }
    writeToLogFile('info', ...args);
  },
  debug: (...args: any[]) => {
    if (!process.env.DEBUG) return;
    if (LOG_MODE === 'strict' || isJsonRpc(args[0])) {
      console.error(...args);
    } else {
      console.debug(...args);
    }
    if (process.env.DEBUG) {
      writeToLogFile('debug', ...args);
    }
  }
};

export default logger;
