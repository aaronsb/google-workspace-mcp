// Mock logger that respects LOG_MODE setting
const LOG_MODE = (process.env.LOG_MODE || 'normal') as 'normal' | 'strict';

const isJsonRpc = (msg: any): boolean => {
  if (typeof msg !== 'string') return false;
  return msg.startsWith('{"jsonrpc":') || msg.startsWith('{"id":');
};

export default {
  error: (...args: any[]) => process.stderr.write(args.join(' ') + '\n'),
  warn: (...args: any[]) => {
    if (LOG_MODE === 'strict' || isJsonRpc(args[0])) {
      process.stderr.write(args.join(' ') + '\n');
    } else {
      process.stdout.write('[WARN] ' + args.join(' ') + '\n');
    }
  },
  info: (...args: any[]) => {
    if (LOG_MODE === 'strict' || isJsonRpc(args[0])) {
      process.stderr.write(args.join(' ') + '\n');
    } else {
      process.stdout.write('[INFO] ' + args.join(' ') + '\n');
    }
  },
  debug: (...args: any[]) => {
    if (!process.env.DEBUG) return;
    if (LOG_MODE === 'strict' || isJsonRpc(args[0])) {
      process.stderr.write(args.join(' ') + '\n');
    } else {
      process.stdout.write('[DEBUG] ' + args.join(' ') + '\n');
    }
  }
};
