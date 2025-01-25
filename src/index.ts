#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleOAuthClient } from './oauth/client.js';
import { TokenManager } from './utils/token.js';
import { AccountManager } from './utils/account.js';
import { GoogleApiRequest } from './api/request.js';
import { RequestHandler } from './api/handler.js';
import { GoogleApiRequestParams, GoogleApiResponse, GoogleApiError } from './types.js';

class GSuiteServer {
  private server: Server;
  private oauthClient?: GoogleOAuthClient;
  private tokenManager?: TokenManager;
  private accountManager?: AccountManager;
  private apiRequest?: GoogleApiRequest;
  
  constructor() {
    this.server = new Server(
      {
        name: "GSuite OAuth MCP Server",
        version: "0.1.0"
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    // Initialize components immediately
    this.oauthClient = new GoogleOAuthClient();
    this.tokenManager = new TokenManager();
    this.accountManager = new AccountManager();
    
    this.setupRequestHandlers();
  }

  private requestHandler?: RequestHandler;

  private async ensureApiRequest(): Promise<void> {
    if (!this.apiRequest) {
      const authClient = await this.oauthClient!.getAuthClient();
      this.apiRequest = new GoogleApiRequest(authClient);
      this.requestHandler = new RequestHandler(this.apiRequest);
    }
  }

  private setupRequestHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'google_api_request',
          description: 'Make authenticated requests to Google APIs',
          inputSchema: {
            type: 'object',
            properties: {
              email: {
                type: 'string',
                description: 'Email address of the Google account'
              },
              category: {
                type: 'string',
                description: 'Account category (e.g., work, personal)'
              },
              description: {
                type: 'string',
                description: 'Account description'
              },
              api_endpoint: {
                type: 'string',
                description: 'Google API endpoint (e.g., "drive.files.list")'
              },
              method: {
                type: 'string',
                enum: ['GET', 'POST', 'PUT', 'DELETE'],
                description: 'HTTP method'
              },
              params: {
                type: 'object',
                description: 'API request parameters'
              },
              required_scopes: {
                type: 'array',
                items: { type: 'string' },
                description: 'Required OAuth scopes'
              },
              auth_code: {
                type: 'string',
                description: 'Authorization code from Google OAuth (only needed during authentication)'
              }
            },
            required: ['email', 'api_endpoint', 'method', 'required_scopes']
          }
        }
      ]
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== 'google_api_request') {
        throw new Error(`Unknown tool: ${request.params.name}`);
      }

      // Ensure API request and handler are initialized
      await this.ensureApiRequest();

      const args = request.params.arguments as unknown as GoogleApiRequestParams;

      try {
        // Validate/create account
        await this.accountManager!.loadAccounts();
        await this.accountManager!.validateAccount(args.email, args.category, args.description);

        // Check token status
        const tokenStatus = await this.tokenManager!.validateToken(args.email, args.required_scopes);

        if (!tokenStatus.valid || !tokenStatus.token) {
          return await this.handleAuthenticationFlow(args, tokenStatus);
        }

        // Process the request through the handler
        const result = await this.requestHandler!.handleRequest(args, tokenStatus.token.access_token);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error: unknown) {
        const response = this.formatErrorResponse(error);
        return {
          content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
          isError: true
        };
      }
    });
  }

  private async handleAuthenticationFlow(
    args: GoogleApiRequestParams,
    tokenStatus: { valid: boolean; token?: any; reason?: string }
  ) {
    if (tokenStatus.token && tokenStatus.reason === 'Token expired') {
      try {
        const newToken = await this.oauthClient!.refreshToken(tokenStatus.token.refresh_token);
        await this.tokenManager!.saveToken(args.email, newToken);
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'refreshing',
              message: 'Token refreshed successfully, please retry the request'
            }, null, 2)
          }]
        };
      } catch (error) {
        tokenStatus.reason = 'Token refresh failed';
      }
    }

    const authUrl = await this.oauthClient!.generateAuthUrl(args.required_scopes);

    if (args.auth_code) {
      try {
        const tokenData = await this.oauthClient!.getTokenFromCode(args.auth_code);
        await this.tokenManager!.saveToken(args.email, tokenData);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              message: 'Authentication successful! Token saved. Please retry your request.'
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              error: error instanceof Error ? error.message : 'Failed to exchange auth code for token',
              message: 'Please ensure you copied the authorization code correctly and try again.'
            }, null, 2)
          }],
          isError: true
        };
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'auth_required',
          auth_url: authUrl,
          message: 'Please complete authentication:',
          instructions: [
            '1. Click the authorization URL below to open Google sign-in',
            '2. Sign in with your Google account',
            '3. Allow the requested permissions',
            '4. Copy the authorization code shown',
            '5. Run this request again with the auth_code parameter set to the code you copied'
          ].join('\n')
        }, null, 2)
      }]
    };
  }

  private formatErrorResponse(error: unknown): GoogleApiResponse {
    if (error instanceof GoogleApiError) {
      return {
        status: 'error',
        error: error.message,
        resolution: error.resolution
      };
    }

    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      resolution: 'Please try again or contact support if the issue persists'
    };
  }

  async run(): Promise<void> {
    try {
      console.error('Initializing GSuite MCP server...');
      
      // Initialize OAuth client and ensure it's ready
      await this.oauthClient!.ensureInitialized();
      
      // Set up error handler for server
      this.server.onerror = (error) => {
        console.error('Server error:', error);
        // Don't exit on error, let the server try to recover
      };
      
      // Connect with retry logic
      const transport = new StdioServerTransport();
      let retries = 3;
      while (retries > 0) {
        try {
          await this.server.connect(transport);
          console.error('GSuite MCP server running successfully');
          return;
        } catch (connectError) {
          retries--;
          if (retries === 0) {
            throw connectError;
          }
          console.error(`Connection attempt failed, retrying... (${retries} attempts remaining)`);
          // Wait a bit before retrying
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } catch (error) {
      console.error('Failed to initialize server:', error);
      throw error;
    }
  }
}

// Start server with proper shutdown handling
const server = new GSuiteServer();

// Handle process signals
process.on('SIGINT', () => {
  console.error('Shutting down GSuite MCP server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Shutting down GSuite MCP server...');
  process.exit(0);
});

// Start with error handling
server.run().catch((error) => {
  console.error('Fatal server error:', error);
  process.exit(1);
});
