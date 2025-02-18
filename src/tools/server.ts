import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import logger from '../utils/logger.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Import tool definitions
import { allTools } from './definitions.js';

// Import handlers
import {
  handleListWorkspaceAccounts,
  handleAuthenticateWorkspaceAccount,
  handleRemoveWorkspaceAccount
} from './account-handlers.js';

import {
  handleSearchWorkspaceEmails,
  handleSendWorkspaceEmail,
  handleGetWorkspaceGmailSettings,
  handleCreateWorkspaceDraft,
  handleGetWorkspaceDrafts,
  handleSendWorkspaceDraft,
  handleGetWorkspaceLabels,
  handleCreateWorkspaceLabel,
  handleUpdateWorkspaceLabel,
  handleDeleteWorkspaceLabel,
  handleModifyWorkspaceMessageLabels
} from './gmail-handlers.js';

import {
  handleListWorkspaceCalendarEvents,
  handleGetWorkspaceCalendarEvent,
  handleManageWorkspaceCalendarEvent,
  handleCreateWorkspaceCalendarEvent,
  handleDeleteWorkspaceCalendarEvent
} from './calendar-handlers.js';

// Import error types
import { AccountError } from '../modules/accounts/types.js';
import { GmailError } from '../modules/gmail/types.js';
import { CalendarError } from '../modules/calendar/types.js';

// Import initialization functions
import { initializeAccountModule } from '../modules/accounts/index.js';
import { initializeGmailModule } from '../modules/gmail/index.js';
import { initializeCalendarModule } from '../modules/calendar/index.js';
import { registerGmailScopes } from '../modules/gmail/scopes.js';
import { registerCalendarScopes } from '../modules/calendar/scopes.js';

// Import types and type guards
import { BaseToolArguments, CalendarEventParams } from './types.js';
import {
  assertBaseToolArguments,
  assertCalendarEventParams,
  assertEmailEventIdArgs
} from './type-guards.js';

export class GSuiteServer {
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
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: allTools
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      try {
        const args = request.params.arguments || {};
        
        switch (request.params.name) {
          // Account Management
          case 'list_workspace_accounts':
            return await handleListWorkspaceAccounts();
          case 'authenticate_workspace_account':
            return await handleAuthenticateWorkspaceAccount(args);
          case 'remove_workspace_account':
            assertBaseToolArguments(args);
            return await handleRemoveWorkspaceAccount(args);

          // Gmail Operations
          case 'search_workspace_emails':
            assertBaseToolArguments(args);
            return await handleSearchWorkspaceEmails(args);
          case 'send_workspace_email':
            assertBaseToolArguments(args);
            return await handleSendWorkspaceEmail(args);
          case 'get_workspace_gmail_settings':
            assertBaseToolArguments(args);
            return await handleGetWorkspaceGmailSettings(args);
          case 'create_workspace_draft':
            assertBaseToolArguments(args);
            return await handleCreateWorkspaceDraft(args);
          case 'get_workspace_drafts':
            assertBaseToolArguments(args);
            return await handleGetWorkspaceDrafts(args);
          case 'send_workspace_draft':
            assertBaseToolArguments(args);
            return await handleSendWorkspaceDraft(args);

          // Calendar Operations
          case 'list_workspace_calendar_events':
            assertCalendarEventParams(args);
            return await handleListWorkspaceCalendarEvents(args);
          case 'get_workspace_calendar_event':
            assertEmailEventIdArgs(args);
            return await handleGetWorkspaceCalendarEvent(args);
          case 'manage_workspace_calendar_event':
            assertBaseToolArguments(args);
            return await handleManageWorkspaceCalendarEvent(args);
          case 'create_workspace_calendar_event':
            assertBaseToolArguments(args);
            return await handleCreateWorkspaceCalendarEvent(args);
          case 'delete_workspace_calendar_event':
            assertEmailEventIdArgs(args);
            return await handleDeleteWorkspaceCalendarEvent(args);

          // Label Management
          case 'get_workspace_labels':
            assertBaseToolArguments(args);
            return await handleGetWorkspaceLabels(args);
          case 'create_workspace_label':
            assertBaseToolArguments(args);
            return await handleCreateWorkspaceLabel(args);
          case 'update_workspace_label':
            assertBaseToolArguments(args);
            return await handleUpdateWorkspaceLabel(args);
          case 'delete_workspace_label':
            assertBaseToolArguments(args);
            return await handleDeleteWorkspaceLabel(args);
          case 'modify_workspace_message_labels':
            assertBaseToolArguments(args);
            return await handleModifyWorkspaceMessageLabels(args);

          default:
            throw new Error(`Unknown tool: ${request.params.name}`);
        }
      } catch (error) {
        const response = this.formatErrorResponse(error);
        return {
          content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
          isError: true,
          _meta: {}
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
