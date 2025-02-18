// Simple logger that writes to stderr to avoid interfering with MCP protocol
const logger = {
  error: (...args: any[]) => console.error('[ERROR]', ...args),
  warn: (...args: any[]) => console.error('[WARN]', ...args),
  info: (...args: any[]) => console.error('[INFO]', ...args),
  debug: (...args: any[]) => {
    if (process.env.DEBUG) {
      console.error('[DEBUG]', ...args);
    }
  }
};

export default logger;
