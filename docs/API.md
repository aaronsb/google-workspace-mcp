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
