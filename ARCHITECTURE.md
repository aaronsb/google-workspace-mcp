# Architecture

## System Overview

The Google Services MCP Server is designed with a modular architecture that separates concerns into distinct components while maintaining a cohesive system for OAuth authentication and API interaction.

```
┌─────────────────┐     ┌──────────────┐     ┌───────────────┐
│  MCP Interface  │────▶│  API Client  │────▶│  OAuth Client │
└─────────────────┘     └──────────────┘     └───────────────┘
         │                      │                     │
         │                      │                     │
         ▼                      ▼                     ▼
┌─────────────────┐     ┌──────────────┐     ┌───────────────┐
│ Account Manager │     │ Token Manager│     │ Config Manager│
└─────────────────┘     └──────────────┘     └───────────────┘
```

## Core Components

### 1. OAuth Client (`src/oauth/client.ts`)
- Implements Google's device code flow for authentication
- Handles token exchange and refresh
- Provides clear authentication instructions
- Asynchronous initialization with promise tracking
- Safe client access with initialization checks
- Consistent error handling with detailed messages

### 2. Token Manager (`src/utils/token.ts`)
- Manages OAuth token lifecycle
- Implements dual storage (file + env)
- Handles token validation and refresh
- Provides scope validation
- Secure token cleanup

### 3. Account Manager (`src/utils/account.ts`)
- Manages Google account configurations
- Validates account information
- Handles account persistence
- Provides account lookup and validation

### 4. API Client (`src/api/request.ts`)
- Makes authenticated Google API requests
- Handles automatic token refresh
- Manages API error handling
- Provides retry mechanisms
- Service-specific initialization (Gmail v1)
- Proper method context binding

## Data Flow

1. Authentication Flow:
```
MCP Tool ──▶ OAuth Client ──▶ Generate Auth URL ──▶ User Authorizes
    ▲                                                    │
    └────────────── Token Manager ◀─── Auth Code ────────┘
```

2. API Request Flow:
```
MCP Tool ──▶ API Client ──▶ Token Manager ──▶ OAuth Client
                 │               │
                 └───▶ Google APIs ◀───┘
```

## Security Considerations

1. Token Storage:
   - Tokens stored in base64 format
   - Environment variable storage for runtime
   - File-based backup storage
   - Secure token cleanup on deletion

2. Authentication:
   - OAuth 2.0 with offline access
   - Automatic token refresh
   - Scope-based access control
   - HTTPS for all API communication

3. Configuration:
   - Separate credential storage
   - Environment-based secrets
   - Secure config loading

## File Structure

```
src/
├── index.ts           # Main entry point
├── types.ts           # Type definitions
├── api/
│   └── request.ts     # API client implementation
├── oauth/
│   └── client.ts      # OAuth implementation
├── utils/
│   ├── account.ts     # Account management
│   └── token.ts       # Token management
└── scripts/
    └── setup-google-env.ts  # Environment setup

config/
├── gauth.json         # OAuth credentials
├── accounts.json      # Account configurations
└── credentials/       # Token storage
```

## Configuration

The server supports environment-based configuration for file paths:

1. Environment Variables:
```
GAUTH_FILE      - Path to OAuth credentials file
ACCOUNTS_FILE   - Path to accounts configuration file
CREDENTIALS_DIR - Directory for token storage
```

2. OAuth Configuration (default: `config/gauth.json`):
```json
{
  "client_id": "...",
  "client_secret": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token"
}
```

3. Account Configuration (default: `config/accounts.json`):
```json
{
  "accounts": [
    {
      "email": "user@example.com",
      "category": "work",
      "description": "Work Account"
    }
  ]
}
```

## Error Handling

The system implements a hierarchical error handling strategy:

1. `GoogleApiError` class for specific error types
2. Error resolution suggestions
3. Automatic retry mechanisms
4. Graceful degradation
5. Clear user feedback for authentication errors

## MCP Integration

1. Tool Schema:
   - Clear parameter descriptions
   - Optional auth_code parameter for authentication
   - Proper scope requirements

2. Response Format:
   - Structured JSON responses
   - Clear authentication instructions
   - Detailed error messages
   - Progress indicators for multi-step operations

3. Authentication Flow:
   - Clear URL presentation
   - Step-by-step instructions
   - Proper error handling
   - Token storage confirmation

## Future Considerations

1. Rate Limiting:
   - Implement request throttling
   - Queue system for bulk operations
   - Rate limit monitoring

2. Caching:
   - Token caching improvements
   - API response caching
   - Cache invalidation strategy

3. Monitoring:
   - Request logging
   - Error tracking
   - Usage analytics

4. Scalability:
   - Multiple account handling
   - Parallel request processing
   - Resource pooling
