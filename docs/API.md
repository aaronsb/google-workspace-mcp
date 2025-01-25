# Google API MCP Server Documentation

## Overview
This MCP server provides authenticated access to Google APIs through a standardized interface. It handles OAuth authentication, token management, and request validation.

## Supported Services

### Gmail (v1)
- `gmail.users.messages.list` - List messages in the user's mailbox
  - Required scopes: `https://www.googleapis.com/auth/gmail.readonly`
  - Parameters:
    - `userId` (string, required): User's email address
    - `maxResults` (number, optional): Maximum number of messages to return
    - `pageToken` (string, optional): Page token for pagination
    - `q` (string, optional): Search query
    - `labelIds` (array, optional): Only return messages with these labels

- `gmail.users.messages.get` - Get a specific message
  - Required scopes: `https://www.googleapis.com/auth/gmail.readonly`
  - Parameters:
    - `userId` (string, required): User's email address
    - `id` (string, required): The ID of the message to retrieve
    - `format` (string, optional): The format to return the message in

- `gmail.users.messages.send` - Send an email message
  - Required scopes: `https://www.googleapis.com/auth/gmail.send`
  - Parameters:
    - `userId` (string, required): User's email address
    - `message` (object, required): The message to send

### Drive (v3)
- `drive.files.list` - List files in Google Drive
  - Required scopes: `https://www.googleapis.com/auth/drive.readonly`
  - Parameters:
    - `pageSize` (number, optional): Maximum number of files to return
    - `pageToken` (string, optional): Page token for pagination
    - `q` (string, optional): Search query
    - `spaces` (string, optional): Which spaces to search
    - `fields` (string, optional): Which fields to include in the response

- `drive.files.get` - Get a specific file's metadata
  - Required scopes: `https://www.googleapis.com/auth/drive.readonly`
  - Parameters:
    - `fileId` (string, required): The ID of the file to retrieve
    - `fields` (string, optional): Which fields to include in the response
    - `acknowledgeAbuse` (boolean, optional): Whether to acknowledge abuse warnings

## Request Format

```typescript
{
  email: string;          // Google account email
  category?: string;      // Account category (e.g., work, personal)
  description?: string;   // Account description
  api_endpoint: string;   // API endpoint (e.g., "drive.files.list")
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: {             // API-specific parameters
    [key: string]: any;
  };
  required_scopes: string[];  // Required OAuth scopes
  auth_code?: string;    // Authorization code (only for initial auth)
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

## Authentication Flow

1. Initial request without token:
   - Server returns auth_required response with OAuth URL
   - User completes OAuth flow and gets authorization code

2. Request with auth_code:
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
