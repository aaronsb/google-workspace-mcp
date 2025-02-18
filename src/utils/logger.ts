// Simple logger that outputs to stderr (Claude desktop will handle log file management)
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
