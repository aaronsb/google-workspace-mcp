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
import { GoogleApiRequestParams, GoogleApiResponse, GoogleApiError } from './types.js';

class GSuiteServer {
  private server: Server;
  private oauthClient: GoogleOAuthClient;
  private tokenManager: TokenManager;
  private accountManager: AccountManager;
  private apiRequest: GoogleApiRequest;
  constructor() {
    // Initialize components
    this.oauthClient = new GoogleOAuthClient();
    this.tokenManager = new TokenManager();
    this.accountManager = new AccountManager();
    this.apiRequest = new GoogleApiRequest(this.oauthClient.getAuthClient());
    // Initialize MCP server
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

    this.setupRequestHandlers();
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

      const args = request.params.arguments as unknown as GoogleApiRequestParams;

      const {
        email,
        category,
        description,
        api_endpoint,
        method,
        params,
        required_scopes
      } = args;

      try {
        // Validate/create account
        await this.accountManager.loadAccounts();
        await this.accountManager.validateAccount(email, category, description);

        // Check token status
        const tokenStatus = await this.tokenManager.validateToken(email, required_scopes);

        if (!tokenStatus.valid || !tokenStatus.token) {
          if (tokenStatus.token && tokenStatus.reason === 'Token expired') {
            try {
              // Attempt token refresh
              const newToken = await this.oauthClient.refreshToken(tokenStatus.token.refresh_token);
              await this.tokenManager.saveToken(email, newToken);
              
              const response: GoogleApiResponse = {
                status: 'refreshing',
                message: 'Token refreshed successfully, please retry the request'
              };
              return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
            } catch (error) {
              // If refresh fails, require re-authentication
              tokenStatus.reason = 'Token refresh failed';
            }
          }

          // Generate auth URL for new authentication
          const authUrl = await this.oauthClient.generateAuthUrl(required_scopes);
          const state = Buffer.from(email).toString('base64');
          const fullAuthUrl = `${authUrl}&state=${state}`;

          // Check if auth code was provided
          if (args.auth_code) {
            const tokenData = await this.oauthClient.getTokenFromCode(args.auth_code);
            await this.tokenManager.saveToken(email, tokenData);
            const response: GoogleApiResponse = {
              status: 'success',
              message: 'Authentication successful! Token saved. Please retry your request.'
            };
            return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
          }

          const response: GoogleApiResponse = {
            status: 'auth_required',
            auth_url: fullAuthUrl,
            instructions: [
              '1. Open this URL in your browser',
              '2. Sign in with your Google account',
              '3. Allow the requested permissions',
              '4. Copy the authorization code shown on the page',
              '5. Retry your request with the auth_code parameter'
            ].join('\n')
          };
          return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
        }

        // Make API request
        const result = await this.apiRequest.makeRequest({
          endpoint: api_endpoint,
          method,
          params,
          token: tokenStatus.token.access_token
        });

        const response: GoogleApiResponse = {
          status: 'success',
          data: result
        };
        return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
      } catch (error: unknown) {
        const apiError = error instanceof Error ? error : new Error('Unknown error occurred');
        const response: GoogleApiResponse = {
          status: 'error',
          error: apiError.message || 'Unknown error occurred',
          resolution: error instanceof GoogleApiError ? error.resolution : undefined
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
          isError: true
        };
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('GSuite MCP server running');
  }
}

// Start server
const server = new GSuiteServer();
server.run().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
