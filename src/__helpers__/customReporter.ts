// @ts-nocheck
const { Reporter } = require('@jest/reporters');

/**
 * Custom Jest reporter that filters stderr output during tests
 * while maintaining MCP protocol compatibility.
 */
class CustomReporter {
  constructor() {
    this.originalStderrWrite = process.stderr.write;
    this.isInTestBlock = false;
  }

  onTestStart() {
    this.isInTestBlock = true;
    
    // Override stderr.write during test execution
    const self = this;
    process.stderr.write = function(buffer, encodingOrCallback, callback) {
      // Handle overloads
      let encoding;
      let cb;
      
      if (typeof encodingOrCallback === 'function') {
        cb = encodingOrCallback;
      } else {
        encoding = encodingOrCallback;
        cb = callback;
      }
      const strContent = buffer.toString();
      
      // Always allow through:
      // 1. MCP protocol messages
      if (strContent.startsWith('{"jsonrpc":') || strContent.startsWith('{"id":')) {
        return self.originalStderrWrite.call(process.stderr, buffer, encoding, cb);
      }

      // 2. Debug mode messages
      if (process.env.DEBUG) {
        return self.originalStderrWrite.call(process.stderr, buffer, encoding, cb);
      }

      // 3. Test progress and results
      if (
        // Test initialization
        strContent.includes('Determining test suites') ||
        // Module progress
        strContent.includes('RUNS') ||
        strContent.includes('PASS') ||
        strContent.includes('FAIL') ||
        strContent.includes('ERROR') ||
        // Progress bars
        strContent.includes('████') ||
        // Test summary
        /^Test Suites:.*total/.test(strContent) ||
        /^Tests:.*total/.test(strContent) ||
        /^Snapshots:.*total/.test(strContent) ||
        /^Time:.*s$/.test(strContent) ||
        strContent.includes('Ran all test suites')
      ) {
        return self.originalStderrWrite.call(process.stderr, buffer, encoding, cb);
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

module.exports = CustomReporter;
