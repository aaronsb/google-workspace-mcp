/**
 * Logger utility with configurable logging behavior.
 * 
 * Supports two logging modes:
 * - normal: Uses appropriate console methods for each log level (error, warn, info, debug)
 * - strict: Routes all non-JSON-RPC messages to stderr for compatibility with tools like Claude desktop
 * 
 * Configure via LOG_MODE environment variable:
 * - LOG_MODE=normal (default) - Standard logging behavior
 * - LOG_MODE=strict - All logs except JSON-RPC go to stderr
 * 
 * For testing: The logger should be mocked in tests to prevent console noise.
 * See src/__helpers__/testSetup.ts for the mock implementation.
 */

type LogMode = 'normal' | 'strict';

const LOG_MODE = (process.env.LOG_MODE || 'normal') as LogMode;

const isJsonRpc = (msg: any): boolean => {
  if (typeof msg !== 'string') return false;
  return msg.startsWith('{"jsonrpc":') || msg.startsWith('{"id":');
};

const logger = {
  error: (...args: any[]) => console.error(...args),
  warn: (...args: any[]) => {
    if (LOG_MODE === 'strict' || isJsonRpc(args[0])) {
      console.error(...args);
    } else {
      console.warn(...args);
    }
  },
  info: (...args: any[]) => {
    if (LOG_MODE === 'strict' || isJsonRpc(args[0])) {
      console.error(...args);
    } else {
      console.info(...args);
    }
  },
  debug: (...args: any[]) => {
    if (!process.env.DEBUG) return;
    if (LOG_MODE === 'strict' || isJsonRpc(args[0])) {
      console.error(...args);
    } else {
      console.debug(...args);
    }
  }
};

export default logger;
