import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import logger from '../utils/logger.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from "@modelcontextprotocol/sdk/types.js";

// Import tool definitions and registry
import { allTools } from './definitions.js';
import { ToolRegistry } from '../modules/tools/registry.js';

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
import {
  BaseToolArguments,
  CalendarEventParams,
  SendEmailArgs,
  CreateDraftArgs,
  SendDraftArgs,
  CreateLabelArgs,
  UpdateLabelArgs,
  DeleteLabelArgs,
  ModifyLabelsArgs,
  AuthenticateAccountArgs
} from './types.js';

import {
  assertBaseToolArguments,
  assertCalendarEventParams,
  assertEmailEventIdArgs,
  assertSendEmailArgs,
  assertCreateDraftArgs,
  assertSendDraftArgs,
  assertCreateLabelArgs,
  assertUpdateLabelArgs,
  assertDeleteLabelArgs,
  assertModifyLabelsArgs
} from './type-guards.js';

export class GSuiteServer {
  private server: Server;
  private toolRegistry: ToolRegistry;

  constructor() {
    this.toolRegistry = new ToolRegistry(allTools);
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
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      // Get tools with categories organized
      const categories = this.toolRegistry.getCategories();
      const toolsByCategory: { [key: string]: Tool[] } = {};
      
      for (const category of categories) {
        // Convert ToolMetadata to Tool (strip out category and aliases for SDK compatibility)
        toolsByCategory[category.name] = category.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }));
      }

      return {
        tools: allTools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        })),
        _meta: {
          categories: toolsByCategory,
          aliases: Object.fromEntries(
            allTools.flatMap(tool => 
              (tool.aliases || []).map(alias => [alias, tool.name])
            )
          )
        }
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      try {
        const args = request.params.arguments || {};
        const toolName = request.params.name;
        
        // Look up the tool using the registry
        const tool = this.toolRegistry.getTool(toolName);
        if (!tool) {
          // Generate helpful error message with suggestions
          const errorMessage = this.toolRegistry.formatErrorWithSuggestions(toolName);
          throw new Error(errorMessage);
        }
        
        // Use the canonical tool name for the switch
        switch (tool.name) {
          // Account Management
          case 'list_workspace_accounts':
            return await handleListWorkspaceAccounts();
          case 'authenticate_workspace_account':
            return await handleAuthenticateWorkspaceAccount(args as AuthenticateAccountArgs);
          case 'remove_workspace_account':
            assertBaseToolArguments(args);
            return await handleRemoveWorkspaceAccount(args);

          // Gmail Operations
          case 'search_workspace_emails':
            assertBaseToolArguments(args);
            return await handleSearchWorkspaceEmails(args);
          case 'send_workspace_email':
            assertSendEmailArgs(args);
            return await handleSendWorkspaceEmail(args as SendEmailArgs);
          case 'get_workspace_gmail_settings':
            assertBaseToolArguments(args);
            return await handleGetWorkspaceGmailSettings(args);
          case 'create_workspace_draft':
            assertCreateDraftArgs(args);
            return await handleCreateWorkspaceDraft(args as CreateDraftArgs);
          case 'get_workspace_drafts':
            assertBaseToolArguments(args);
            return await handleGetWorkspaceDrafts(args);
          case 'send_workspace_draft':
            assertSendDraftArgs(args);
            return await handleSendWorkspaceDraft(args as SendDraftArgs);

          // Calendar Operations
          case 'list_workspace_calendar_events':
            assertCalendarEventParams(args);
            return await handleListWorkspaceCalendarEvents(args as CalendarEventParams);
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
            assertCreateLabelArgs(args);
            return await handleCreateWorkspaceLabel(args as CreateLabelArgs);
          case 'update_workspace_label':
            assertUpdateLabelArgs(args);
            return await handleUpdateWorkspaceLabel(args as UpdateLabelArgs);
          case 'delete_workspace_label':
            assertDeleteLabelArgs(args);
            return await handleDeleteWorkspaceLabel(args as DeleteLabelArgs);
          case 'modify_workspace_message_labels':
            assertModifyLabelsArgs(args);
            return await handleModifyWorkspaceMessageLabels(args as ModifyLabelsArgs);

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
