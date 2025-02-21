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
  handleManageWorkspaceLabelFilter,
  handleManageWorkspaceAttachment
} from './gmail-handlers.js';

import {
  handleListWorkspaceCalendarEvents,
  handleGetWorkspaceCalendarEvent,
  handleManageWorkspaceCalendarEvent,
  handleCreateWorkspaceCalendarEvent,
  handleDeleteWorkspaceCalendarEvent
} from './calendar-handlers.js';

import {
  handleListDriveFiles,
  handleSearchDriveFiles,
  handleUploadDriveFile,
  handleDownloadDriveFile,
  handleCreateDriveFolder,
  handleUpdateDrivePermissions,
  handleDeleteDriveFile
} from './drive-handlers.js';

// Import error types
import { AccountError } from '../modules/accounts/types.js';
import { GmailError } from '../modules/gmail/types.js';
import { CalendarError } from '../modules/calendar/types.js';

// Import service initializer
import { initializeAllServices } from '../utils/service-initializer.js';

// Import types and type guards
import {
  CalendarEventParams,
  SendEmailArgs,
  AuthenticateAccountArgs,
  ManageDraftParams,
  ManageAttachmentParams
} from './types.js';
import {
  ManageLabelParams,
  ManageLabelAssignmentParams,
  ManageLabelFilterParams
} from '../modules/gmail/services/label.js';

import {
  assertBaseToolArguments,
  assertCalendarEventParams,
  assertEmailEventIdArgs,
  assertSendEmailArgs,
  assertManageDraftParams,
  assertManageLabelParams,
  assertManageLabelAssignmentParams,
  assertManageLabelFilterParams,
  assertDriveFileListArgs,
  assertDriveSearchArgs,
  assertDriveUploadArgs,
  assertDriveDownloadArgs,
  assertDriveFolderArgs,
  assertDrivePermissionArgs,
  assertDriveDeleteArgs,
  assertManageAttachmentParams
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
        
        let result;
        // Use the canonical tool name for the switch
        switch (tool.name) {
          // Account Management
          case 'list_workspace_accounts':
            result = await handleListWorkspaceAccounts();
            break;
          case 'authenticate_workspace_account':
            result = await handleAuthenticateWorkspaceAccount(args as AuthenticateAccountArgs);
            break;
          case 'remove_workspace_account':
            assertBaseToolArguments(args);
            result = await handleRemoveWorkspaceAccount(args);
            break;

          // Gmail Operations
          case 'search_workspace_emails':
            assertBaseToolArguments(args);
            result = await handleSearchWorkspaceEmails(args);
            break;
          case 'send_workspace_email':
            assertSendEmailArgs(args);
            result = await handleSendWorkspaceEmail(args as SendEmailArgs);
            break;
          case 'get_workspace_gmail_settings':
            assertBaseToolArguments(args);
            result = await handleGetWorkspaceGmailSettings(args);
            break;
          case 'manage_workspace_draft':
            assertManageDraftParams(args);
            result = await handleManageWorkspaceDraft(args as ManageDraftParams);
            break;

          case 'manage_workspace_attachment':
            assertManageAttachmentParams(args);
            result = await handleManageWorkspaceAttachment(args as ManageAttachmentParams);
            break;

          // Calendar Operations
          case 'list_workspace_calendar_events':
            assertCalendarEventParams(args);
            result = await handleListWorkspaceCalendarEvents(args as CalendarEventParams);
            break;
          case 'get_workspace_calendar_event':
            assertEmailEventIdArgs(args);
            result = await handleGetWorkspaceCalendarEvent(args);
            break;
          case 'manage_workspace_calendar_event':
            assertBaseToolArguments(args);
            result = await handleManageWorkspaceCalendarEvent(args);
            break;
          case 'create_workspace_calendar_event':
            assertBaseToolArguments(args);
            result = await handleCreateWorkspaceCalendarEvent(args);
            break;
          case 'delete_workspace_calendar_event':
            assertEmailEventIdArgs(args);
            result = await handleDeleteWorkspaceCalendarEvent(args);
            break;

          // Label Management
          case 'manage_workspace_label':
            assertManageLabelParams(args);
            result = await handleManageWorkspaceLabel(args as unknown as ManageLabelParams);
            break;
          case 'manage_workspace_label_assignment':
            assertManageLabelAssignmentParams(args);
            result = await handleManageWorkspaceLabelAssignment(args as unknown as ManageLabelAssignmentParams);
            break;
          case 'manage_workspace_label_filter':
            assertManageLabelFilterParams(args);
            result = await handleManageWorkspaceLabelFilter(args as unknown as ManageLabelFilterParams);
            break;

          // Drive Operations
          case 'list_drive_files':
            assertDriveFileListArgs(args);
            result = await handleListDriveFiles(args);
            break;
          case 'search_drive_files':
            assertDriveSearchArgs(args);
            result = await handleSearchDriveFiles(args);
            break;
          case 'upload_drive_file':
            assertDriveUploadArgs(args);
            result = await handleUploadDriveFile(args);
            break;
          case 'download_drive_file':
            assertDriveDownloadArgs(args);
            result = await handleDownloadDriveFile(args);
            break;
          case 'create_drive_folder':
            assertDriveFolderArgs(args);
            result = await handleCreateDriveFolder(args);
            break;
          case 'update_drive_permissions':
            assertDrivePermissionArgs(args);
            result = await handleUpdateDrivePermissions(args);
            break;
          case 'delete_drive_file':
            assertDriveDeleteArgs(args);
            result = await handleDeleteDriveFile(args);
            break;

          default:
            throw new Error(`Unknown tool: ${request.params.name}`);
        }

        // Wrap result in McpToolResponse format
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }],
          _meta: {}
        };
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
      const details = error instanceof GmailError ? error.details :
                     error instanceof AccountError ? error.resolution :
                     error instanceof CalendarError ? error.message :
                     'Please try again or contact support if the issue persists';
      
      return {
        status: 'error',
        error: error.message,
        resolution: details
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
      
      // Initialize all services
      await initializeAllServices();
      
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
