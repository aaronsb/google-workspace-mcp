# GSuite OAuth MCP Server Documentation

## Overview
This MCP server provides tools for managing Google account authentication and access to Google APIs. It handles OAuth authentication flows, token management, and account configuration.

## Available Tools

### 1. list_google_accounts
Lists all configured Google accounts and their authentication status.

#### Request Format
```typescript
// No parameters required
{}
```

#### Response Format
```typescript
[
  {
    email: string;          // Google account email
    category: string;       // Account category (e.g., work, personal)
    description: string;    // Account description
    auth_status: {
      has_token: boolean;   // Whether account has valid token
      scopes?: string[];    // Currently authorized scopes
      expires?: number;     // Token expiration timestamp
    }
  }
]
```

### 2. authenticate_google_account
Handles Google account authentication, including initial setup and token refresh.

#### Request Format
```typescript
{
  email: string;           // Google account email
  category?: string;       // Account category (e.g., work, personal)
  description?: string;    // Account description
  required_scopes: string[]; // Required OAuth scopes
  auth_code?: string;      // Authorization code (only for initial auth)
}
```

## Response Format

### Success Response
```typescript
{
  status: "success",
  data: {
    // API-specific response data
  }
}
```

### Error Response
```typescript
{
  status: "error",
  error: string,      // Error message
  resolution?: string // Suggested resolution steps
}
```

### Authentication Required Response
```typescript
{
  status: "auth_required",
  auth_url: string,   // OAuth URL to complete authentication
  message: string,    // User instructions
  instructions: string // Step-by-step auth instructions
}
```

### Token Refresh Response
```typescript
{
  status: "refreshing",
  message: string     // Confirmation of token refresh
}
```

## Error Handling

Common error codes and their meanings:

- `INVALID_SERVICE`: The requested API service is not supported
- `INVALID_METHOD`: The requested API method is not supported
- `INVALID_ENDPOINT`: Malformed API endpoint
- `MISSING_REQUIRED_PARAMS`: Required parameters are missing
- `INVALID_PARAM_TYPE`: Parameter type mismatch
- `SERVICE_NOT_SUPPORTED`: Requested service is not implemented
- `METHOD_NOT_FOUND`: Requested method doesn't exist
- `API_REQUEST_ERROR`: General API request failure

HTTP Status Codes:
- 400: Bad Request - Check parameters
- 401: Unauthorized - Token expired or invalid
- 403: Forbidden - Insufficient permissions
- 404: Not Found - Resource doesn't exist
- 429: Too Many Requests - Rate limit exceeded
- 500: Server Error - Internal error
- 503: Service Unavailable - Temporary outage

## Initial Setup

### Google Cloud Console Setup

1. Create a new project in Google Cloud Console:
   - Go to https://console.cloud.google.com
   - Click "Select a project" > "New Project"
   - Enter a project name and create

2. Enable required APIs:
   - Go to "APIs & Services" > "Library"
   - Search for and enable the APIs you need (e.g., Gmail API, Google Calendar API)

3. Configure OAuth consent screen:
   - Go to "APIs & Services" > "OAuth consent screen"
   - Choose "External" user type
   - Fill in required app information
   - Add necessary scopes based on the APIs you enabled
   - Add your test users' email addresses

4. Create OAuth credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "Desktop application" as application type
   - Give it a name and create

5. Configure OAuth credentials:
   - Download the client credentials JSON
   - Create a `config/gauth.json` file with the following structure:
     ```json
     {
       "client_id": "your-client-id.apps.googleusercontent.com",
       "client_secret": "your-client-secret",
       "redirect_uri": "urn:ietf:wg:oauth:2.0:oob",
       "auth_uri": "https://accounts.google.com/o/oauth2/auth",
       "token_uri": "https://oauth2.googleapis.com/token"
     }
     ```

### Environment Configuration

1. Configure the MCP server in your Claude desktop config:
   ```json
   {
     "mcpServers": {
       "gsuite": {
         "command": "node",
         "args": ["path/to/gsuite-mcp/build/index.js"],
         "env": {
           "AUTH_CONFIG_FILE": "path/to/gsuite-mcp/config/gauth.json",
           "ACCOUNTS_FILE": "path/to/gsuite-mcp/config/accounts.json",
           "CREDENTIALS_DIR": "path/to/gsuite-mcp/config/credentials"
         }
       }
     }
   }
   ```

## Authentication Flow

1. Initial request without token:
   - Server returns auth_required response with OAuth URL
   - User opens the URL in a browser
   - Google displays authorization screen with a code
   - User copies the authorization code

2. Request with auth_code:
   - User provides the copied authorization code
   - Server exchanges code for access/refresh tokens
   - Tokens are saved for future use
   - User should retry original request

3. Subsequent requests:
   - Server automatically uses saved tokens
   - Handles token refresh when needed
   - Returns API response directly

## Best Practices

1. Error Handling
   - Always check response status
   - Handle authentication flows appropriately
   - Retry requests after token refresh

2. Scopes
   - Request minimum required scopes
   - Check documentation for required scopes
   - Handle scope validation errors

3. Parameters
   - Validate parameters before sending
   - Use correct parameter types
   - Include all required parameters
