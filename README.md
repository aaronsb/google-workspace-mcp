# Google Workspace MCP Server

A Model Context Protocol (MCP) server that provides authenticated access to Google Workspace APIs, currently focused on Gmail functionality with Calendar support in development.

## Features

- **Gmail Integration**: Complete email operations (list, get, send messages)
- **OAuth Authentication**: Robust OAuth 2.0 flow with token refresh
- **Account Management**: Multi-account support with secure token handling
- **Error Handling**: Detailed error messages with resolution steps
- **Modular Design**: Extensible architecture for additional services

## Current Capabilities

- **Gmail Operations**:
  - List and fetch emails with filtering
  - Send emails with CC/BCC support
  - Gmail-specific error handling

- **Account Management**:
  - Multiple account support
  - Secure token storage
  - Automatic token refresh

## Documentation

- [API Documentation](docs/API.md): Available tools and usage
- [Architecture](ARCHITECTURE.md): System design and components
- [Error Handling](docs/ERRORS.md): Error types and resolution

## Getting Started

1. **Setup Google Cloud Project**
   - Create project in Google Cloud Console
   - Enable Gmail API
   - Configure OAuth consent screen
   - Create OAuth 2.0 credentials

2. **Configuration**
   ```bash
   # Set up environment variables
   AUTH_CONFIG_FILE=/path/to/gauth.json
   ACCOUNTS_FILE=/path/to/accounts.json
   CREDENTIALS_DIR=/path/to/credentials
   ```

3. **Basic Usage**
   ```typescript
   // List emails
   const response = await use_mcp_tool({
     server_name: "gsuite",
     tool_name: "get_emails",
     arguments: {
       email: "user@example.com",
       maxResults: 10,
       labelIds: ["INBOX"]
     }
   });

   // Send email
   await use_mcp_tool({
     server_name: "gsuite",
     tool_name: "send_email",
     arguments: {
       email: "user@example.com",
       to: ["recipient@example.com"],
       subject: "Hello",
       body: "Message content"
     }
   });
   ```

## Available Tools

### Account Management
- `list_google_accounts`: List configured accounts
- `use_google_account`: Add/authenticate account
- `forget_google_account`: Remove account

### Gmail Operations
- `get_emails`: Fetch emails with filtering
- `send_email`: Send emails with CC/BCC

See [API Documentation](docs/API.md) for detailed usage.

## Coming Soon

### Calendar Integration (In Development)
- Event management
- Calendar operations
- Meeting scheduling

### Future Services
- Drive API integration
- Admin SDK support
- Additional Google services

## Best Practices

1. **Authentication**
   - Store credentials securely
   - Use minimal required scopes
   - Handle token refresh properly

2. **Error Handling**
   - Check response status
   - Handle auth errors appropriately
   - Implement proper retries

3. **Configuration**
   - Use environment variables
   - Secure credential storage
   - Regular token rotation

## License

MIT License - See LICENSE file for details
