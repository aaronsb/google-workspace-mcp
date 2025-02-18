// In tests, write directly to stderr to maintain MCP protocol compatibility
// while avoiding Jest's console.error handling
export default {
  error: (...args: any[]) => process.stderr.write(args.join(' ') + '\n'),
  warn: (...args: any[]) => process.stderr.write(args.join(' ') + '\n'),
  info: (...args: any[]) => process.stderr.write(args.join(' ') + '\n'),
  debug: (...args: any[]) => {
    if (process.env.DEBUG) {
      process.stderr.write(args.join(' ') + '\n');
    }
  }
};
