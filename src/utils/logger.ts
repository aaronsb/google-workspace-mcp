import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logFile = path.join(logsDir, 'gsuite-mcp.log');

export class Logger {
  private static writeToFile(level: string, message: string) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} [${level}] ${message}\n`;
    
    fs.appendFileSync(logFile, logMessage);
  }

  static info(message: string | object) {
    const msg = typeof message === 'object' ? JSON.stringify(message, null, 2) : message;
    this.writeToFile('INFO', msg);
  }

  static error(message: string | object, error?: Error) {
    const msg = typeof message === 'object' ? JSON.stringify(message, null, 2) : message;
    const errorDetails = error ? `\nError: ${error.message}\nStack: ${error.stack}` : '';
    this.writeToFile('ERROR', `${msg}${errorDetails}`);
  }

  static debug(message: string | object) {
    if (process.env.DEBUG) {
      const msg = typeof message === 'object' ? JSON.stringify(message, null, 2) : message;
      this.writeToFile('DEBUG', msg);
    }
  }
}
