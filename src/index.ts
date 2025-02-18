#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import logger from './utils/logger.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Core module imports for account management and Gmail functionality
import { initializeAccountModule, getAccountManager } from './modules/accounts/index.js';
import { initializeGmailModule, getGmailService } from './modules/gmail/index.js';
import { registerGmailScopes } from './modules/gmail/scopes.js';

// Calendar module imports - provides Google Calendar integration
import { initializeCalendarModule, getCalendarService } from './modules/calendar/index.js';
import { registerCalendarScopes } from './modules/calendar/scopes.js';

// Error types for proper error handling and user feedback
import { AccountError } from './modules/accounts/types.js';
import { GmailError } from './modules/gmail/types.js';
import { CalendarError } from './modules/calendar/types.js';

// Scope registry for managing tool scopes
import { scopeRegistry } from './modules/tools/scope-registry.js';

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
          tools: {
            list: true,
            call: true
          }
        }
      }
    );

    this.setupRequestHandlers();
  }

  private setupRequestHandlers(): void {
    // IMPORTANT: Tools must be registered in BOTH ListToolsRequestSchema and CallToolRequestSchema handlers
    // to be visible to the AI. If a tool is not listed in ListToolsRequestSchema, the AI won't know it exists,
    // even if it has a handler in CallToolRequestSchema.
    
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'list_workspace_accounts',
          description: 'List all configured Google accounts and their authentication status',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'authenticate_workspace_account',
          description: 'Add and authenticate a Google account for API access. IMPORTANT: When authenticating, always use the exact auth_url from the API response to ensure all OAuth parameters are preserved correctly. REQUIRED: When you get the auth_url, you must share it with the user by providing it in a response. The user will then click it to visit the URL and authorize the app. After authorization, the user will share that response with you.',
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
              auth_code: {
                type: 'string',
                description: 'Authorization code from Google OAuth (only needed during initial authentication)'
              }
            },
            required: ['email']
          }
        },
        {
          name: 'remove_workspace_account',
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
          name: 'search_workspace_emails',
          description: 'Search emails in a Gmail account with advanced filtering capabilities',
          inputSchema: {
            type: 'object',
            properties: {
              email: {
                type: 'string',
                description: 'Email address of the Gmail account'
              },
              search: {
                type: 'object',
                description: 'Search criteria for filtering emails',
                properties: {
                  from: {
                    oneOf: [
                      { type: 'string' },
                      { type: 'array', items: { type: 'string' } }
                    ],
                    description: 'Search by sender email address(es)'
                  },
                  to: {
                    oneOf: [
                      { type: 'string' },
                      { type: 'array', items: { type: 'string' } }
                    ],
                    description: 'Search by recipient email address(es)'
                  },
                  subject: {
                    type: 'string',
                    description: 'Search in email subject lines'
                  },
                  content: {
                    type: 'string',
                    description: 'Search in email body text'
                  },
                  after: {
                    type: 'string',
                    description: 'Search emails after this date (YYYY-MM-DD)'
                  },
                  before: {
                    type: 'string',
                    description: 'Search emails before this date (YYYY-MM-DD)'
                  },
                  hasAttachment: {
                    type: 'boolean',
                    description: 'Filter emails with attachments'
                  },
                  labels: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Include emails with these labels (e.g., INBOX, SENT, IMPORTANT)'
                  },
                  excludeLabels: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Exclude emails with these labels'
                  },
                  includeSpam: {
                    type: 'boolean',
                    description: 'Include emails from spam/trash folders'
                  },
                  isUnread: {
                    type: 'boolean',
                    description: 'Filter by read/unread status'
                  }
                }
              },
              maxResults: {
                type: 'number',
                description: 'Maximum number of emails to return (default: 10)'
              }
            },
            required: ['email']
          }
        },
        {
          name: 'send_workspace_email',
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
        },
        {
          name: 'get_workspace_gmail_settings',
          description: 'Get Gmail settings and profile information for a workspace account',
          inputSchema: {
            type: 'object',
            properties: {
              email: {
                type: 'string',
                description: 'Email address of the Gmail account'
              }
            },
            required: ['email']
          }
        },
        {
          name: 'create_workspace_draft',
          description: 'Create a new email draft, with support for both new emails and replies',
          inputSchema: {
            type: 'object',
            properties: {
              email: {
                type: 'string',
                description: 'Email address of the Gmail account'
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
              },
              replyToMessageId: {
                type: 'string',
                description: 'Message ID to reply to (for creating reply drafts)'
              },
              threadId: {
                type: 'string',
                description: 'Thread ID for the email (optional for replies)'
              },
              references: {
                type: 'array',
                items: { type: 'string' },
                description: 'Reference message IDs for email threading'
              },
              inReplyTo: {
                type: 'string',
                description: 'Message ID being replied to (for email threading)'
              }
            },
            required: ['email', 'to', 'subject', 'body']
          }
        },
        {
          name: 'get_workspace_drafts',
          description: 'Get a list of email drafts',
          inputSchema: {
            type: 'object',
            properties: {
              email: {
                type: 'string',
                description: 'Email address of the Gmail account'
              },
              maxResults: {
                type: 'number',
                description: 'Maximum number of drafts to return (default: 10)'
              },
              pageToken: {
                type: 'string',
                description: 'Page token for pagination'
              }
            },
            required: ['email']
          }
        },
        {
          name: 'send_workspace_draft',
          description: 'Send an existing draft',
          inputSchema: {
            type: 'object',
            properties: {
              email: {
                type: 'string',
                description: 'Email address of the Gmail account'
              },
              draftId: {
                type: 'string',
                description: 'ID of the draft to send'
              }
            },
            required: ['email', 'draftId']
          }
        },
        // Calendar Tools
        // Note: These tools require calendar.events.readonly scope for reading events
        // and calendar.events scope for creating/modifying events
        {
          name: 'list_workspace_calendar_events',
          description: 'Get calendar events with optional filtering',
          inputSchema: {
            type: 'object',
            properties: {
              email: {
                type: 'string',
                description: 'Email address of the calendar owner'
              },
              query: {
                type: 'string',
                description: 'Optional text search within events'
              },
              maxResults: {
                type: 'number',
                description: 'Maximum number of events to return (default: 10)'
              },
              timeMin: {
                type: 'string',
                description: 'Start of time range to search (ISO date string)'
              },
              timeMax: {
                type: 'string',
                description: 'End of time range to search (ISO date string)'
              }
            },
            required: ['email']
          }
        },
        {
          name: 'get_workspace_calendar_event',
          description: 'Get a single calendar event by ID',
          inputSchema: {
            type: 'object',
            properties: {
              email: {
                type: 'string',
                description: 'Email address of the calendar owner'
              },
              eventId: {
                type: 'string',
                description: 'Unique identifier of the event to retrieve'
              }
            },
            required: ['email', 'eventId']
          }
        },
        {
          name: 'create_workspace_calendar_event',
          description: 'Create a new calendar event',
          inputSchema: {
            type: 'object',
            properties: {
              email: {
                type: 'string',
                description: 'Email address of the calendar owner'
              },
              summary: {
                type: 'string',
                description: 'Event title'
              },
              description: {
                type: 'string',
                description: 'Optional event description'
              },
              start: {
                type: 'object',
                properties: {
                  dateTime: {
                    type: 'string',
                    description: 'Event start time (ISO date string)'
                  },
                  timeZone: {
                    type: 'string',
                    description: 'Timezone for start time'
                  }
                },
                required: ['dateTime']
              },
              end: {
                type: 'object',
                properties: {
                  dateTime: {
                    type: 'string',
                    description: 'Event end time (ISO date string)'
                  },
                  timeZone: {
                    type: 'string',
                    description: 'Timezone for end time'
                  }
                },
                required: ['dateTime']
              },
              attendees: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    email: {
                      type: 'string',
                      description: 'Attendee email address'
                    }
                  },
                  required: ['email']
                },
                description: 'Optional list of event attendees'
              }
            },
            required: ['email', 'summary', 'start', 'end']
          }
        }
      ]
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case 'list_workspace_accounts': {
            const accounts = await getAccountManager().listAccounts();
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(accounts, null, 2)
              }]
            };
          }

          case 'authenticate_workspace_account': {
            const accountManager = getAccountManager();
            const args = request.params.arguments as any;

            // Validate/create account
            await accountManager.validateAccount(args.email, args.category, args.description);

            // If auth code is provided, complete the OAuth flow
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

            // Start OAuth flow
            const authUrl = await accountManager.generateAuthUrl();
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  status: 'auth_required',
                  auth_url: authUrl,
                  message: 'Please complete authentication:',
                  instructions: [
                    '0. Share a clickable authorization URL link below with the user to authenticate',
                    '1. Instruct the user to click the authorization URL to open Google sign-in',
                    '2. Sign in with your Google account',
                    '3. Allow the requested permissions',
                    '4. Copy the authorization code shown',
                    '5. Run this request again with the auth_code parameter set to the code you copied'
                  ].join('\n')
                }, null, 2)
              }]
            };
          }

          case 'remove_workspace_account': {
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

          case 'search_workspace_emails': {
            // Convert the structured search criteria into the format expected by getEmails
            const args = request.params.arguments as any;
            const params = {
              email: args.email,
              search: args.search || {},
              options: {
                maxResults: args.maxResults
              }
            };
            const emails = await getGmailService().getEmails(params);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(emails, null, 2)
              }]
            };
          }

          case 'send_workspace_email': {
            const result = await getGmailService().sendEmail(request.params.arguments as any);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }]
            };
          }

          case 'get_workspace_gmail_settings': {
            const result = await getGmailService().getWorkspaceGmailSettings(request.params.arguments as any);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }]
            };
          }

          // Calendar Tool Handlers
          case 'list_workspace_calendar_events': {
            // Fetch calendar events with support for filtering by date range, query, and max results
            const events = await getCalendarService().getEvents(request.params.arguments as any);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(events, null, 2)
              }]
            };
          }

          case 'get_workspace_calendar_event': {
            // Get detailed information about a specific calendar event
            const { email, eventId } = request.params.arguments as { email: string, eventId: string };
            const event = await getCalendarService().getEvent(email, eventId);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(event, null, 2)
              }]
            };
          }

          case 'create_workspace_calendar_event': {
            // Create a new calendar event with optional attendees
            // Note: This automatically sends email notifications to attendees
            const event = await getCalendarService().createEvent(request.params.arguments as any);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(event, null, 2)
              }]
            };
          }

          case 'create_workspace_draft': {
            const result = await getGmailService().createDraft(request.params.arguments as any);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }]
            };
          }

          case 'get_workspace_drafts': {
            const result = await getGmailService().getDrafts(request.params.arguments as any);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }]
            };
          }

          case 'send_workspace_draft': {
            const result = await getGmailService().sendDraft(request.params.arguments as any);
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
    if (error instanceof AccountError || error instanceof GmailError || error instanceof CalendarError) {
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
      // Initialize server
      logger.info('Loading API scopes...');
      registerGmailScopes();
      registerCalendarScopes();
      
      // Initialize modules in order
      logger.info('Initializing account module...');
      await initializeAccountModule();
      
      logger.info('Initializing Gmail module...');
      await initializeGmailModule();
      
      logger.info('Initializing Calendar module...');
      await initializeCalendarModule();
      
      // Set up error handler
      this.server.onerror = (error) => console.error('MCP Error:', error);
      
      // Connect transport
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      logger.info('Google Workspace MCP server running on stdio');
    } catch (error) {
      logger.error('Fatal server error:', error);
      throw error;
    }
  }
}

// Start server with proper shutdown handling
const server = new GSuiteServer();

// Handle process signals
process.on('SIGINT', () => {
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});

// Start with error handling
server.run().catch(error => {
  console.error('Fatal Error:', error);
  process.exit(1);
});
