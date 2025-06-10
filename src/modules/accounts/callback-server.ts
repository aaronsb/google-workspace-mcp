import http from 'http';
import url from 'url';
import logger from '../../utils/logger.js';

export class OAuthCallbackServer {
  private static instance?: OAuthCallbackServer;
  private server?: http.Server;
  private port: number = 8080;
  private isRunning: boolean = false;
  private pendingPromises: Map<string, { resolve: (code: string) => void; reject: (error: Error) => void }> = new Map();
  
  private constructor() {}
  
  static getInstance(): OAuthCallbackServer {
    if (!OAuthCallbackServer.instance) {
      OAuthCallbackServer.instance = new OAuthCallbackServer();
    }
    return OAuthCallbackServer.instance;
  }
  
  async ensureServerRunning(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url || '', true);
        
        if (parsedUrl.pathname === '/') {
          const code = parsedUrl.query.code as string;
          const error = parsedUrl.query.error as string;
          const state = parsedUrl.query.state as string || 'default';
          
          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body>
                  <h1>Authorization Failed</h1>
                  <p>Error: ${error}</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `);
            
            // Reject any pending promises
            const pending = this.pendingPromises.get(state);
            if (pending) {
              pending.reject(new Error(`OAuth error: ${error}`));
              this.pendingPromises.delete(state);
            }
            return;
          }
          
          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <head>
                  <title>Google OAuth Authorization Successful</title>
                  <style>
                    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
                    .code-box { 
                      background: #f5f5f5; 
                      border: 2px solid #ddd; 
                      padding: 15px; 
                      margin: 20px 0; 
                      font-family: monospace; 
                      font-size: 14px; 
                      word-break: break-all;
                      cursor: pointer;
                    }
                    .code-box:hover { background: #e8e8e8; }
                    .instructions { background: #e7f3ff; padding: 15px; border-left: 4px solid #2196F3; }
                    ol li { margin: 8px 0; }
                  </style>
                </head>
                <body>
                  <h1>✅ Authorization Successful!</h1>
                  
                  <div class="instructions">
                    <h3>📋 Copy Your Authorization Code</h3>
                    <p>Click the code below to select it, then copy and paste it back to Claude Desktop:</p>
                  </div>
                  
                  <div class="code-box" onclick="selectCode()" id="authCode">
                    ${code}
                  </div>
                  
                  <div class="instructions">
                    <h3>📝 Next Steps:</h3>
                    <ol>
                      <li><strong>Copy</strong> the authorization code above (click to select)</li>
                      <li><strong>Return</strong> to Claude Desktop</li>
                      <li><strong>Provide</strong> the code to complete your Google account authentication</li>
                      <li><strong>Close</strong> this window after copying the code</li>
                    </ol>
                  </div>
                  
                  <script>
                    function selectCode() {
                      const codeElement = document.getElementById('authCode');
                      const range = document.createRange();
                      range.selectNodeContents(codeElement);
                      const selection = window.getSelection();
                      selection.removeAllRanges();
                      selection.addRange(range);
                    }
                    
                    // Auto-select the code when page loads
                    window.onload = function() {
                      selectCode();
                    };
                  </script>
                </body>
              </html>
            `);
            
            // Resolve the corresponding promise
            const pending = this.pendingPromises.get(state);
            if (pending) {
              pending.resolve(code);
              this.pendingPromises.delete(state);
            }
            return;
          }
        }
        
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Not Found</h1></body></html>');
      });
      
      this.server.listen(this.port, () => {
        this.isRunning = true;
        logger.info(`OAuth callback server listening on http://localhost:${this.port}`);
        resolve();
      });
      
      this.server.on('error', (err) => {
        this.isRunning = false;
        reject(err);
      });
    });
  }
  
  async waitForAuthorizationCode(sessionId: string = 'default'): Promise<string> {
    await this.ensureServerRunning();
    
    return new Promise((resolve, reject) => {
      // Store the promise resolvers for this session
      this.pendingPromises.set(sessionId, { resolve, reject });
      
      // Set a timeout to avoid hanging forever
      setTimeout(() => {
        if (this.pendingPromises.has(sessionId)) {
          this.pendingPromises.delete(sessionId);
          reject(new Error('OAuth timeout - no authorization received within 5 minutes'));
        }
      }, 5 * 60 * 1000); // 5 minutes timeout
    });
  }
  
  getCallbackUrl(): string {
    return `http://localhost:${this.port}`;
  }
  
  isServerRunning(): boolean {
    return this.isRunning;
  }
}
