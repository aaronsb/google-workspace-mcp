/**
 * Logger utility that outputs all logs to stderr.
 * 
 * IMPORTANT: We specifically use stderr for all logging levels (even info) because:
 * 1. It keeps logs separate from the MCP tool's stdout JSON stream
 * 2. Prevents log messages from corrupting the JSON communication protocol
 * 3. Allows the desktop app to properly capture and manage logs
 * 
 * For testing: The logger should be mocked in tests to prevent console.error noise.
 * See src/__helpers__/testSetup.ts for the mock implementation.
 */
const logger = {
  error: (...args: any[]) => console.error(...args),
  warn: (...args: any[]) => console.error(...args),
  info: (...args: any[]) => console.error(...args),
  debug: (...args: any[]) => {
    if (process.env.DEBUG) {
      console.error(...args);
    }
  }
};

export default logger;
