#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { initializeAccountModule, getAccountManager } from './modules/accounts/index.js';
import { initializeGmailModule, getGmailService } from './modules/gmail/index.js';
import { AccountError } from './modules/accounts/types.js';
import { GmailError } from './modules/gmail/types.js';

class GSuiteServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "Google Workspace MCP Server",
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
          name: 'list_google_accounts',
          description: 'List all configured Google accounts and their authentication status',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'use_google_account',
          description: 'Add and authenticate a Google account for API access',
          inputSchema: {
            type: 'object',
            properties: {
              email: {
                type: 'string',
                description: 'Email address of the Google account to authenticate'
              },
              category: {
                type: 'string',
                description: 'Account category (e.g., work, personal)'
              },
              description: {
                type: 'string',
                description: 'Account description'
              },
              required_scopes: {
                type: 'array',
                items: { type: 'string' },
                description: 'Required OAuth scopes for the account'
              },
              auth_code: {
                type: 'string',
                description: 'Authorization code from Google OAuth (only needed during initial authentication)'
              }
            },
            required: ['email', 'required_scopes']
          }
        },
        {
          name: 'forget_google_account',
          description: 'Remove a Google account and delete its associated authentication tokens',
          inputSchema: {
            type: 'object',
            properties: {
              email: {
                type: 'string',
                description: 'Email address of the Google account to remove'
              }
            },
            required: ['email']
          }
        },
        {
          name: 'get_emails',
          description: 'Get emails from a Gmail account with optional filtering',
          inputSchema: {
            type: 'object',
            properties: {
              email: {
                type: 'string',
                description: 'Email address of the Gmail account'
              },
              query: {
                type: 'string',
                description: 'Search query to filter emails'
              },
              maxResults: {
                type: 'number',
                description: 'Maximum number of emails to return (default: 10)'
              },
              labelIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of label IDs to filter by (default: ["INBOX"])'
              }
            },
            required: ['email']
          }
        },
        {
          name: 'send_email',
          description: 'Send an email from a Gmail account',
          inputSchema: {
            type: 'object',
            properties: {
              email: {
                type: 'string',
                description: 'Email address to send from'
              },
              to: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of recipient email addresses'
              },
              subject: {
                type: 'string',
                description: 'Email subject'
              },
              body: {
                type: 'string',
                description: 'Email body content'
              },
              cc: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of CC recipient email addresses'
              },
              bcc: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of BCC recipient email addresses'
              }
            },
            required: ['email', 'to', 'subject', 'body']
          }
        }
      ]
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case 'list_google_accounts': {
            const accounts = await getAccountManager().listAccounts();
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(accounts, null, 2)
              }]
            };
          }

          case 'use_google_account': {
            const accountManager = getAccountManager();
            const args = request.params.arguments as any;

            // Validate/create account
            await accountManager.validateAccount(args.email, args.category, args.description);

            // Check token status
            const tokenStatus = await accountManager.validateToken(args.email, args.required_scopes);

            if (!tokenStatus.valid || !tokenStatus.token) {
              if (tokenStatus.token && tokenStatus.reason === 'Token expired') {
                const newToken = await accountManager.refreshToken(tokenStatus.token.refresh_token);
                await accountManager.saveToken(args.email, newToken);
                
                return {
                  content: [{
                    type: 'text',
                    text: JSON.stringify({
                      status: 'refreshing',
                      message: 'Token refreshed successfully, please retry the request'
                    }, null, 2)
                  }]
                };
              }

              if (args.auth_code) {
                const tokenData = await accountManager.getTokenFromCode(args.auth_code);
                await accountManager.saveToken(args.email, tokenData);
                return {
                  content: [{
                    type: 'text',
                    text: JSON.stringify({
                      status: 'success',
                      message: 'Authentication successful! Token saved. Please retry your request.'
                    }, null, 2)
                  }]
                };
              }

              const authUrl = await accountManager.generateAuthUrl(args.required_scopes);
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

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  status: 'success',
                  message: 'Account is already authenticated with required scopes'
                }, null, 2)
              }]
            };
          }

          case 'forget_google_account': {
            const { email } = request.params.arguments as { email: string };
            await getAccountManager().removeAccount(email);
            
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  status: 'success',
                  message: `Successfully removed account ${email} and deleted associated tokens`
                }, null, 2)
              }]
            };
          }

          case 'get_emails': {
            const emails = await getGmailService().getEmails(request.params.arguments as any);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(emails, null, 2)
              }]
            };
          }

          case 'send_email': {
            const result = await getGmailService().sendEmail(request.params.arguments as any);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }]
            };
          }

          default:
            throw new Error(`Unknown tool: ${request.params.name}`);
        }
      } catch (error) {
        const response = this.formatErrorResponse(error);
        return {
          content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
          isError: true
        };
      }
    });
  }

  private formatErrorResponse(error: unknown) {
    if (error instanceof AccountError || error instanceof GmailError) {
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
      console.error('Initializing Google Workspace MCP server...');
      
      // Initialize modules
      await initializeAccountModule();
      await initializeGmailModule();
      
      // Set up error handler for server
      this.server.onerror = (error) => {
        console.error('Server error:', error);
        // Don't exit on error, let the server try to recover
      };
      
      // Connect to transport
      const transport = new StdioServerTransport();
      try {
        await this.server.connect(transport);
        console.error('Google Workspace MCP server running successfully');
      } catch (error) {
        console.error('Failed to connect to transport:', error);
        throw error;
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
  console.error('Shutting down Google Workspace MCP server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Shutting down Google Workspace MCP server...');
  process.exit(0);
});

// Start with error handling
server.run().catch((error) => {
  console.error('Fatal server error:', error);
  process.exit(1);
});
