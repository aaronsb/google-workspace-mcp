// @ts-nocheck

/**
 * Custom Jest reporter that selectively filters stderr output during tests
 * while maintaining MCP protocol compatibility.
 * 
 * This reporter is necessary because MCP tools communicate via stderr,
 * which can interfere with Jest's test output. The reporter:
 * 
 * 1. Allows through all MCP protocol messages (JSON-RPC format)
 * 2. Allows through Jest's own test progress/results output
 * 3. Filters out other stderr output that could confuse the test results
 * 
 * This ensures clean test output while preserving the MCP tool communication
 * that happens over stderr.
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

      // 3. Test progress, results, and error details
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
        strContent.includes('Ran all test suites') ||
        // Error details
        strContent.includes('Expected:') ||
        strContent.includes('Received:') ||
        strContent.includes('Error:') ||
        strContent.includes('at ') ||  // Stack traces
        strContent.includes('● ') ||   // Test case descriptions
        strContent.includes('expect(') // Jest expectations
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
