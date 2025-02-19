import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import logger from '../utils/logger.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from "@modelcontextprotocol/sdk/types.js";

// Get docker hash from environment
const DOCKER_HASH = process.env.DOCKER_HASH || 'unknown';

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
  handleManageWorkspaceDraft,
  handleManageWorkspaceLabel,
  handleManageWorkspaceLabelAssignment,
  handleManageWorkspaceLabelFilter
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
  AuthenticateAccountArgs,
  ManageLabelParams,
  ManageLabelAssignmentParams,
  ManageLabelFilterParams,
  ManageDraftParams
} from './types.js';

import {
  assertBaseToolArguments,
  assertCalendarEventParams,
  assertEmailEventIdArgs,
  assertSendEmailArgs,
  assertManageDraftParams,
  assertManageLabelParams,
  assertManageLabelAssignmentParams,
  assertManageLabelFilterParams
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
    // Tools are registered through the ToolRegistry which serves as a single source of truth
    // for both tool discovery (ListToolsRequestSchema) and execution (CallToolRequestSchema).
    // Tools only need to be defined once in allTools and the registry handles making them
    // available to both handlers.
    
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
          case 'manage_workspace_draft':
            assertManageDraftParams(args);
            return await handleManageWorkspaceDraft(args as ManageDraftParams);

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
          case 'manage_workspace_label':
            assertManageLabelParams(args);
            return await handleManageWorkspaceLabel(args);
          case 'manage_workspace_label_assignment':
            assertManageLabelAssignmentParams(args);
            return await handleManageWorkspaceLabelAssignment(args);
          case 'manage_workspace_label_filter':
            assertManageLabelFilterParams(args);
            return await handleManageWorkspaceLabelFilter(args);

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
      logger.info(`google-workspace-mcp v0.9.0 (docker: ${DOCKER_HASH})`);
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
