import type { Reporter, Test } from '@jest/reporters';

/**
 * Custom Jest reporter that filters stderr output during tests
 * while maintaining MCP protocol compatibility.
 */
class CustomReporter implements Reporter {
  private originalStderrWrite: typeof process.stderr.write;
  private isInTestBlock = false;

  constructor() {
    // Store original stderr.write
    this.originalStderrWrite = process.stderr.write;
  }

  onTestStart() {
    this.isInTestBlock = true;
    
    // Override stderr.write during test execution
    process.stderr.write = (chunk: any, ...args: any[]) => {
      const str = chunk.toString();
      
      // Always allow through:
      // 1. MCP protocol messages
      if (str.startsWith('{"jsonrpc":') || str.startsWith('{"id":')) {
        return this.originalStderrWrite.call(process.stderr, chunk, ...args);
      }

      // 2. Debug mode messages
      if (process.env.DEBUG) {
        return this.originalStderrWrite.call(process.stderr, chunk, ...args);
      }

      // 3. Test progress and results
      if (
        // Test initialization
        str.includes('Determining test suites') ||
        // Module progress
        str.includes('RUNS') ||
        str.includes('PASS') ||
        str.includes('FAIL') ||
        str.includes('ERROR') ||
        // Progress bars
        str.includes('████') ||
        // Test summary
        /^Test Suites:.*total/.test(str) ||
        /^Tests:.*total/.test(str) ||
        /^Snapshots:.*total/.test(str) ||
        /^Time:.*s$/.test(str) ||
        str.includes('Ran all test suites')
      ) {
        return this.originalStderrWrite.call(process.stderr, chunk, ...args);
      }

      // Filter out non-test output (like console.error logs)
      return true;
    };
  }

  onTestComplete() {
    this.isInTestBlock = false;
  }

  onRunComplete() {
    // Restore original stderr.write
    process.stderr.write = this.originalStderrWrite;
  }

  // Required Reporter interface methods
  getLastError() {}
  onRunStart() {}
  onTestResult() {}
}

export default CustomReporter;
