# Architecture

## Design Philosophy: Simplest Viable Design

This project follows the "simplest viable design" principle, which emerged from our experience with AI systems' tendency toward over-engineering, particularly in OAuth scope handling. This principle addresses a pattern we term "scope fondling" - where AI systems optimize for maximum anticipated flexibility rather than minimal necessary permissions.

Key aspects of this approach:
- Minimize complexity in permission structures
- Handle auth through simple HTTP response codes (401/403)
- Move OAuth mechanics entirely into platform infrastructure
- Present simple verb-noun interfaces to AI agents
- Focus on core operational requirements over edge cases

This principle helps prevent goal misgeneralization, where AI systems might otherwise create unnecessary complexity in authentication paths, connection management, and permission hierarchies.

## System Overview

The Google Services MCP Server implements a modular architecture focused on Gmail functionality with planned expansion to other Google services. The system is built around core modules that handle authentication, account management, and service-specific operations.

```mermaid
graph TD
    MCP[MCP Server] --> AM[Account Module]
    subgraph AccountModule[Account Module]
        OC[OAuth Client]
        TM[Token Manager]
    end
    AM --> SM[Service Modules]
    subgraph ServiceModules[Service Modules]
        GM[Gmail Module]
        CM["Calendar Module
        (Planned)"]
    end
```

## Core Components (Current Implementation)

### 1. Scope Registry (src/modules/tools/scope-registry.ts)
- Simple scope collection system
- Gathers required scopes at startup
- Used only for initial auth setup
- No runtime validation - handled by API responses

### 2. MCP Server (src/index.ts)
- Registers and manages available tools
- Handles request routing and validation
- Provides consistent error handling
- Manages server lifecycle

### 3. Account Module (src/modules/accounts/*)
- OAuth Client:
  - Implements Google OAuth 2.0 flow
  - Handles token exchange and refresh
  - Provides authentication URLs
  - Manages client credentials
- Token Manager:
  - Handles token lifecycle
  - Validates and refreshes tokens
  - Manages token storage
- Account Manager:
  - Manages account configurations
  - Handles account persistence
  - Validates account status

### 4. Gmail Module (src/modules/gmail/*)
- Implements email operations:
  - List and fetch emails
  - Send emails
  - Handle Gmail-specific errors
- Manages Gmail API integration
- Handles Gmail authentication scopes

## Data Flows

### Operation Flow
```mermaid
sequenceDiagram
    participant TR as Tool Request
    participant S as Service
    participant API as Google API

    TR->>S: Request
    S->>API: API Call
    alt Success
        API-->>TR: Return Response
    else Auth Error (401/403)
        S->>S: Refresh Token
        S->>API: Retry API Call
        API-->>TR: Return Response
    end
```

### Auth Flow
```mermaid
sequenceDiagram
    participant TR as Tool Request
    participant S as Service
    participant AM as Account Manager
    participant API as Google API

    TR->>S: Request
    S->>API: API Call
    alt Success
        API-->>TR: Return Response
    else Auth Error
        S->>AM: Refresh Token
        alt Refresh Success
            S->>API: Retry API Call
            API-->>TR: Return Response
        else Refresh Failed
            AM-->>TR: Request Re-auth
        end
    end
```

## Implementation Details

### Testing Strategy

The project follows a simplified unit testing approach that emphasizes:

```mermaid
graph TD
    A[Unit Tests] --> B[Simplified Mocks]
    A --> C[Focused Tests]
    A --> D[Clean State]
    
    B --> B1[Static Responses]
    B --> B2[Simple File System]
    B --> B3[Basic OAuth]
    
    C --> C1[Grouped by Function]
    C --> C2[Single Responsibility]
    C --> C3[Clear Assertions]
    
    D --> D1[Reset Modules]
    D --> D2[Fresh Instances]
    D --> D3[Tracked Mocks]
```

#### Key Testing Principles

1. **Simplified Mocking**
   - Use static mock responses instead of complex simulations
   - Mock external dependencies with minimal implementations
   - Focus on behavior verification over implementation details
   - Avoid end-to-end complexity in unit tests

2. **Test Organization**
   - Group tests by functional area (e.g., account operations, file operations)
   - Each test verifies a single piece of functionality
   - Clear test descriptions that document behavior
   - Independent test cases that don't rely on shared state

3. **Mock Management**
   - Reset modules and mocks between tests
   - Track mock function calls explicitly
   - Re-require modules after mock changes
   - Verify both function calls and results

4. **File System Testing**
   - Use simple JSON structures
   - Focus on data correctness over formatting
   - Test error scenarios explicitly
   - Verify operations without implementation details

5. **Token Handling**
   - Mock token validation with static responses
   - Test success and failure scenarios separately
   - Focus on account manager's token handling logic
   - Avoid OAuth complexity in unit tests

This approach ensures tests are:
- Reliable and predictable
- Easy to maintain
- Quick to execute
- Clear in intent
- Focused on behavior

### Security
- OAuth 2.0 implementation with offline access
- Secure token storage and management
- Scope-based access control
- Environment-based configuration
- Secure credential handling

### Error Handling
- Simplified auth error handling through 401/403 responses
- Automatic token refresh on auth failures
- Service-specific error types
- Clear authentication error guidance

### Configuration
- OAuth credentials via environment variables
- Secure token storage in user's home directory
- Account configuration management
- Token persistence handling

## Project Structure

### Docker Container Structure
```
/app/
├── src/              # Application source code
│   ├── index.ts     # MCP server implementation
│   ├── modules/     # Core functionality modules
│   └── scripts/     # Utility scripts
├── config/          # Mount point for persistent data
│   ├── accounts.json     # Account configurations
│   └── credentials/     # Token storage
└── Dockerfile       # Container definition
```

### Local Development Structure
```
project/
├── src/             # Source code (mounted in container)
├── Dockerfile       # Container definition
└── docker-entrypoint.sh  # Container startup script
```

### Host Machine Structure
```
~/.mcp/google-workspace-mcp/  # Persistent data directory
├── accounts.json        # Account configurations
└── credentials/        # Token storage
```

## Configuration

### Container Environment Variables
```
GOOGLE_CLIENT_ID      - OAuth client ID
GOOGLE_CLIENT_SECRET  - OAuth client secret
GOOGLE_REDIRECT_URI   - OAuth redirect URI (optional)
```

### Volume Mounts
```
~/.mcp/google-workspace-mcp:/app/config  # Persistent data storage
```

### Data Directory Structure
The server uses a Docker volume mounted at `/app/config` to store:

1. Account Configuration (accounts.json):
```json
{
  "accounts": [{
    "email": "user@example.com",
    "category": "work",
    "description": "Work Account"
  }]
}
```

2. Credentials Directory:
- Contains OAuth tokens for each account
- Tokens are stored securely with appropriate permissions
- Each token file is named using the account's email address

## Planned Extensions

### Calendar Module (In Development)
- Event management
- Calendar operations
- Meeting scheduling
- Availability checking

### Future Services
- Drive API integration
- Admin SDK support
- Additional Google services

### Planned Features
- Rate limiting
- Response caching
- Request logging
- Performance monitoring
- Multi-account optimization
