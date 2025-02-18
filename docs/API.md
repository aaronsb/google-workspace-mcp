# Google Workspace MCP Server API Documentation

## Overview
This MCP server provides tools for Gmail and Calendar operations along with Google account management. The server handles OAuth authentication, token management, and API interactions with Google Workspace services.

IMPORTANT: Before using this server, you must set up your own Google Cloud Project and obtain OAuth 2.0 credentials. See the Setup Guide section below for detailed instructions.

This server uses out-of-band (OOB) authentication flow, which means:
- No callback server is required
- Users manually copy-paste authorization codes
- The redirect URI must be set to "urn:ietf:wg:oauth:2.0:oob"
- Each account requires a one-time manual authentication step

## Setup Guide

### 1. Google Cloud Project Setup (Required)

Before using this MCP server, you must:

1. Create a new project in [Google Cloud Console](https://console.cloud.google.com):
   - Go to console.cloud.google.com
   - Click "Select a project" → "New Project"
   - Note your project ID

2. Enable required APIs:
   - Navigate to "APIs & Services" → "Library"
   - Search for and enable:
     * Gmail API
     * Google Calendar API
   - Wait for APIs to fully enable

3. Configure OAuth consent screen:
   - Go to "APIs & Services" → "OAuth consent screen"
   - Choose "External" user type
   - Fill in required app information
   - Add required scopes (see Common Scopes section below)
   - Add your email as a test user
   - Save and continue

4. Create OAuth credentials:
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "OAuth client ID"
   - Choose "Desktop application" type
   - Note your Client ID and Client Secret
   - Set redirect URI to: urn:ietf:wg:oauth:2.0:oob

### 2. MCP Server Configuration

Configure the server through your MCP settings file (e.g., `cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "google-workspace-mcp": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-v", "~/.mcp/google-workspace-mcp:/app/config",
        "-e", "GOOGLE_CLIENT_ID",
        "-e", "GOOGLE_CLIENT_SECRET",
        "-e", "GOOGLE_REDIRECT_URI",
        "ghcr.io/aaronsb/google-workspace-mcp:latest"
      ],
      "env": {
        "GOOGLE_CLIENT_ID": "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "YOUR_CLIENT_SECRET_HERE",
        "GOOGLE_REDIRECT_URI": "urn:ietf:wg:oauth:2.0:oob"
      },
      "autoApprove": [],
      "disabled": false
    }
  }
}
```

The server uses a data directory (`~/.mcp/google-workspace-mcp`) to store:
- `accounts.json`: List of configured Google accounts
- `credentials/`: Directory containing OAuth tokens for each account

## Tool Registration Requirements

IMPORTANT: For a tool to be visible to the AI, it must be registered in two places:
1. The `ListToolsRequestSchema` handler - This defines the tool's interface and makes it discoverable
2. The `CallToolRequestSchema` handler - This implements the tool's functionality

If a tool is not registered in the `ListToolsRequestSchema` handler, the AI won't know it exists, even if it has a handler implementation in `CallToolRequestSchema`. This is a common pitfall when adding new tools - always ensure both handlers are properly configured.

## Available Tools

### Tool Naming Convention
All tools in this MCP follow a verb-noun pattern to clearly indicate their function:
- `list_workspace_accounts` - Lists (verb) accounts (noun)
- `authenticate_workspace_account` - Authenticates (verb) an account (noun)
- `get_workspace_calendar_event` - Gets (verb) a calendar event (noun)
- `send_workspace_email` - Sends (verb) an email (noun)

Note: Tools that only retrieve data use verbs like "get" or "list", indicating they don't modify the resource. Future tools that modify these resources will use appropriate verbs like "update" or "set".

### Account Management

#### 1. list_workspace_accounts
Lists all configured Google accounts and their authentication status.

**Request Format**
```typescript
// No parameters required
{}
```

**Response Format**
```typescript
[{
  email: string;          // Google account email
  category?: string;      // Account category (e.g., work, personal)
  description?: string;   // Account description
  auth_status: {
    has_token: boolean;   // Whether account has valid token
    scopes?: string[];    // Currently authorized scopes
    expires?: number;     // Token expiration timestamp
  }
}]
```

#### 2. authenticate_workspace_account
Add and authenticate a Google account for API access.

**Request Format**
```typescript
{
  email: string;           // Email address of the Google account
  category?: string;       // Account category (e.g., work, personal)
  description?: string;    // Account description
  required_scopes: string[]; // Required OAuth scopes
  auth_code?: string;      // Authorization code from OAuth consent screen
}
```

#### 3. remove_workspace_account
Remove a Google account and delete its associated authentication tokens.

**Request Format**
```typescript
{
  email: string;          // Email address of the account to remove
}
```

### Calendar Operations

#### 1. list_workspace_calendar_events
Get events from a Google Calendar with optional filtering.

**Request Format**
```typescript
{
  email: string;           // Email address of the Calendar account
  query?: string;         // Search query to filter events
  maxResults?: number;    // Maximum number of events (default: 10)
  timeMin?: string;      // Start of time range (ISO string)
  timeMax?: string;      // End of time range (ISO string)
}
```

#### 2. get_workspace_calendar_event
Get a specific calendar event by ID.

**Request Format**
```typescript
{
  email: string;          // Email address of the Calendar account
  eventId: string;       // ID of the event to retrieve
}
```

#### 3. create_workspace_calendar_event
Create a new calendar event.

**Request Format**
```typescript
{
  email: string;           // Email address of the Calendar account
  summary: string;        // Event title
  description?: string;   // Event description
  start: {
    dateTime: string;    // Start time (ISO string)
    timeZone?: string;   // Optional timezone
  };
  end: {
    dateTime: string;    // End time (ISO string)
    timeZone?: string;   // Optional timezone
  };
  attendees?: {          // Optional list of attendees
    email: string;
  }[];
}
```

### Gmail Operations

#### 1. search_workspace_emails
Search emails with advanced filtering capabilities.

**Request Format**
```typescript
{
  email: string;           // Email address of the Gmail account
  query?: string;          // Advanced search query with filters
  maxResults?: number;     // Maximum number of emails (default: 10)
  labelIds?: string[];     // List of label IDs (default: ["INBOX"])
  messageIds?: string[];   // Optional list of specific message IDs to retrieve
}
```

**Search Query Examples**
```
is:unread                           // Only unread messages
from:sender@example.com             // Messages from specific sender
after:2024/01/01 before:2024/01/31 // Date range
has:attachment                      // Messages with attachments
```

#### 2. get_workspace_gmail_settings
Get Gmail settings and profile information.

**Request Format**
```typescript
{
  email: string;           // Email address of the Gmail account
}
```

**Response Format**
```typescript
{
  profile: {
    emailAddress: string;
    messagesTotal: number;
    threadsTotal: number;
    historyId: string;
  };
  settings: {
    autoForwarding: {
      enabled: boolean;
      emailAddress?: string;
    };
    imap: {
      enabled: boolean;
      autoExpunge: boolean;
      expungeBehavior: string;
    };
    language: {
      displayLanguage: string;
    };
    pop: {
      accessWindow: string;
      disposition: string;
    };
    vacationResponder: {
      enabled: boolean;
      startTime?: string;
      endTime?: string;
      message?: string;
    };
  };
}
```

#### 3. send_workspace_email
Send an email from a Gmail account.

**Request Format**
```typescript
{
  email: string;           // Email address to send from
  to: string[];           // List of recipient email addresses
  subject: string;        // Email subject
  body: string;           // Email body content
  cc?: string[];         // Optional CC recipients
  bcc?: string[];        // Optional BCC recipients
}
```

#### 4. create_workspace_draft
Create a new email draft, with support for both new emails and replies.

**Request Format**
```typescript
{
  email: string;           // Email address of the Gmail account
  to: string[];           // List of recipient email addresses
  subject: string;        // Email subject
  body: string;           // Email body content
  cc?: string[];         // Optional CC recipients
  bcc?: string[];        // Optional BCC recipients
  replyToMessageId?: string;  // Message ID to reply to
  threadId?: string;      // Thread ID for the email
  references?: string[];  // Reference message IDs for threading
  inReplyTo?: string;    // Message ID being replied to
}
```

#### 5. get_workspace_drafts
Get a list of email drafts with pagination support.

**Request Format**
```typescript
{
  email: string;           // Email address of the Gmail account
  maxResults?: number;     // Maximum number of drafts (default: 10)
  pageToken?: string;      // Page token for pagination
}
```

#### 6. send_workspace_draft
Send an existing draft.

**Request Format**
```typescript
{
  email: string;           // Email address of the Gmail account
  draftId: string;        // ID of the draft to send
}
```

## Authentication Flow

1. Initial Setup:
   ```typescript
   // Register account with necessary scopes
   await use_mcp_tool({
     server_name: "google-workspace-mcp",
     tool_name: "authenticate_workspace_account",
     arguments: {
       email: "your.email@example.com"
     }
   });
   // → Returns auth_url to complete OAuth
   ```

2. Complete Auth:
   ```typescript
   // Complete OAuth flow with auth code
   await use_mcp_tool({
     server_name: "google-workspace-mcp",
     tool_name: "authenticate_workspace_account",
     arguments: {
       email: "your.email@example.com",
       auth_code: "PASTE_AUTH_CODE_HERE"  // Code from OAuth consent screen
     }
   });
   ```

3. Use Services:
   ```typescript
   // Auth errors handled automatically through 401/403 responses
   await use_mcp_tool({
     server_name: "google-workspace-mcp",
     tool_name: "send_workspace_email",
     arguments: {
       email: "your.email@example.com",
       to: ["recipient.email@example.com"],
       subject: "Test Email",
       body: "Hello World"
     }
   });
   // If auth fails:
   // 1. Token refresh attempted automatically
   // 2. Operation retried after refresh
   // 3. If refresh fails, auth_url returned for re-auth
   ```

## Response Formats

### Success Response
```typescript
{
  content: [{
    type: 'text',
    text: JSON.stringify({
      status: 'success',
      // Operation-specific data
    })
  }]
}
```

### Error Response
```typescript
{
  content: [{
    type: 'text',
    text: JSON.stringify({
      status: 'error',
      error: string,      // Error message
      resolution: string  // Resolution steps
    })
  }],
  isError: true
}
```

### Authentication Required Response
```typescript
{
  content: [{
    type: 'text',
    text: JSON.stringify({
      status: 'auth_required',
      auth_url: string,    // OAuth URL
      message: string,     // User instructions
      instructions: string // Step-by-step guide
    })
  }]
}
```

### Auth Error Response (401/403)
```typescript
{
  content: [{
    type: 'text',
    text: JSON.stringify({
      status: 'auth_error',
      error: 'Authentication failed',
      message: 'Token refresh in progress...'
    })
  }]
}
```

### Token Refresh Success
```typescript
{
  content: [{
    type: 'text',
    text: JSON.stringify({
      status: 'success',
      message: 'Token refreshed and operation retried successfully'
    })
  }]
}
```

## Common Scopes

### Gmail Scopes
- `https://www.googleapis.com/auth/gmail.readonly` - Read-only access
- `https://www.googleapis.com/auth/gmail.send` - Send emails only
- `https://www.googleapis.com/auth/gmail.modify` - All read/write operations
- `https://www.googleapis.com/auth/gmail.compose` - Create/send emails
- `https://www.googleapis.com/auth/gmail.settings.basic` - Access basic settings
- `https://www.googleapis.com/auth/gmail.settings.sharing` - Access sharing settings

### Calendar Scopes
- `https://www.googleapis.com/auth/calendar.readonly` - Read-only access to calendars
- `https://www.googleapis.com/auth/calendar.events` - Read/write access to events
- `https://www.googleapis.com/auth/calendar` - Full access to calendars and events

## Error Types

### Calendar Errors
- `FETCH_ERROR`: Failed to get calendar events
- `CREATE_ERROR`: Failed to create calendar event
- `AUTH_REQUIRED`: Calendar authentication needed
- `MODULE_NOT_INITIALIZED`: Calendar module not ready

### Account Errors
- `AUTH_CONFIG_ERROR`: OAuth configuration issues
- `AUTH_CLIENT_ERROR`: OAuth client initialization failed
- `AUTH_CODE_ERROR`: Invalid authorization code
- `TOKEN_REFRESH_ERROR`: Token refresh failed
- `MODULE_NOT_INITIALIZED`: Account module not ready

### Gmail Errors
- `FETCH_ERROR`: Failed to get emails
- `SEND_ERROR`: Failed to send email
- `AUTH_REQUIRED`: Gmail authentication needed
- `MODULE_NOT_INITIALIZED`: Gmail module not ready
