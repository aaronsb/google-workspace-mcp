# System Patterns

## Architecture
The system follows a modular architecture with clear separation of concerns:

### Core Components
1. **Scope Registry** (src/modules/tools/scope-registry.ts)
   - Simple scope collection system
   - Gathers required scopes at startup
   - Used only for initial auth setup

2. **MCP Server** (src/index.ts)
   - Registers and manages available tools
   - Handles request routing and validation
   - Provides consistent error handling

3. **Account Module** (src/modules/accounts/*)
   - OAuth Client: Implements Google OAuth 2.0 flow
   - Token Manager: Handles token lifecycle
   - Account Manager: Manages account configurations

4. **Service Modules**
   - Gmail Module: Implements email operations
   - Calendar Module: Handles calendar operations

## Key Technical Decisions
1. **Simplest Viable Design**
   - Minimize complexity in permission structures
   - Handle auth through HTTP response codes (401/403)
   - Move OAuth mechanics into platform infrastructure
   - Present simple verb-noun interfaces

2. **Tool Registration Pattern**
   - Tools must be registered in both ListToolsRequestSchema and CallToolRequestSchema
   - Follows verb-noun naming convention (e.g., list_workspace_accounts)

3. **Error Handling**
   - Simplified auth error handling through 401/403 responses
   - Automatic token refresh on auth failures
   - Service-specific error types
   - Clear authentication error guidance

## Project Structure
```
src/
├── index.ts                 # MCP server implementation
├── modules/
│   ├── accounts/           # Account & auth handling
│   │   ├── index.ts       # Module entry point
│   │   ├── manager.ts     # Account management
│   │   ├── oauth.ts       # OAuth implementation
│   │   └── token.ts       # Token handling
│   └── gmail/             # Gmail implementation
│       ├── index.ts       # Module entry point
│       ├── service.ts     # Gmail operations
│       └── types.ts       # Gmail types
└── scripts/
    └── setup-google-env.ts # Setup utilities
```

## Configuration Patterns
- Environment-based file paths
- Separate credential storage
- Account configuration management
- Token persistence handling
- Security through proper credential and token management
