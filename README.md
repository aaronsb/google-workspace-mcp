# Google Workspace MCP Server

[![smithery badge](https://smithery.ai/badge/@aaronsb/google-workspace-mcp)](https://smithery.ai/server/@aaronsb/google-workspace-mcp)
[![glama badge](https://glama.ai/mcp/servers/0finyxgwlk/badge)](https://glama.ai/mcp/servers/0finyxgwlk)

A Model Context Protocol (MCP) server that provides authenticated access to Google Workspace APIs, offering comprehensive Gmail and Calendar functionality.

## Quick Start

The MCP server is fully self-configuring and only requires three inputs:

1. Google OAuth Client ID
2. Google OAuth Client Secret
3. Local directory path for storing configuration (recommended: `~/.mcp/google-workspace-mcp`)

### Using with Cline

Add the following configuration to your Cline MCP settings:

```json
{
  "mcpServers": {
    "google-workspace-mcp": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-v", "${HOME}/.mcp/google-workspace-mcp:/app/config",
        "-e", "GOOGLE_CLIENT_ID",
        "-e", "GOOGLE_CLIENT_SECRET",
        "-e", "GOOGLE_REDIRECT_URI",
        "ghcr.io/aaronsb/google-workspace-mcp:latest"
      ],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "your-client-secret",
        "GOOGLE_REDIRECT_URI": "urn:ietf:wg:oauth:2.0:oob"
      },
      "autoApprove": [],
      "disabled": false
    }
  }
}
```

### Manual Usage

You can also run the container directly:

```bash
docker run -i --rm \
  -v ~/.mcp/google-workspace-mcp:/app/config \
  -e GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com \
  -e GOOGLE_CLIENT_SECRET=your-client-secret \
  -e GOOGLE_REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob \
  ghcr.io/aaronsb/google-workspace-mcp:latest
```

The server will automatically:
- Create and manage all necessary configuration files
- Handle secure storage of credentials and tokens
- Maintain proper file permissions

### Development Build

For local development, you can build and run the container:

```bash
# Build the image
docker build -t google-workspace-mcp:local .

# Run with required environment variables
docker run -i --rm \
  -v ~/.mcp/google-workspace-mcp:/app/config \
  -e GOOGLE_CLIENT_ID=your_client_id \
  -e GOOGLE_CLIENT_SECRET=your_client_secret \
  -e GOOGLE_REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob \
  google-workspace-mcp:local
```

## Available Tools

### Account Management
- `list_workspace_accounts`: List configured accounts
- `authenticate_workspace_account`: Add/authenticate account
- `remove_workspace_account`: Remove account

### Gmail Operations
- `list_workspace_emails`: Fetch emails with filtering
- `send_workspace_email`: Send emails with CC/BCC

### Calendar Operations
- `list_workspace_calendar_events`: List calendar events with filtering
- `get_workspace_calendar_event`: Get a specific calendar event
- `create_workspace_calendar_event`: Create a new calendar event

See [API Documentation](docs/API.md) for detailed usage.

## Coming Soon

### Future Services
- Drive API integration
- Admin SDK support
- Additional Google services

## Testing Strategy

### Unit Testing Approach

1. **Simplified Mocking**
   - Use static mock responses for predictable testing
   - Avoid complex end-to-end simulations in unit tests
   - Focus on testing one piece of functionality at a time
   - Mock external dependencies (OAuth, file system) with simple implementations

2. **Test Organization**
   - Group tests by functionality (e.g., account operations, file operations)
   - Use clear, descriptive test names
   - Keep tests focused and isolated
   - Reset mocks and modules between tests

3. **Mock Management**
   - Use jest.resetModules() to ensure clean state
   - Re-require modules after mock changes
   - Track mock function calls explicitly
   - Verify both function calls and results

4. **File System Testing**
   - Use simple JSON structures
   - Focus on data correctness over formatting
   - Test error scenarios (missing files, invalid JSON)
   - Verify file operations without implementation details

5. **Token Handling**
   - Mock token validation with static responses
   - Test success and failure scenarios separately
   - Verify token operations without OAuth complexity
   - Focus on account manager's token handling logic

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test path/to/test.ts

# Run tests with coverage
npm test -- --coverage
```

## Best Practices

1. **Authentication**
   - Store credentials securely in MCP settings
   - Use minimal required scopes
   - Handle token refresh properly

2. **Error Handling**
   - Check response status
   - Handle auth errors appropriately
   - Implement proper retries

3. **Configuration & Security**
   - Each user maintains their own Google Cloud Project
   - Configure OAuth credentials in MCP settings
   - Secure token storage in ~/.mcp/google-workspace-mcp
   - Regular token rotation
   - Never commit sensitive files to git
   - Use proper file permissions for config directory

4. **Local Development Setup**
   - Configure OAuth credentials in MCP settings
   - Create ~/.mcp/google-workspace-mcp directory
   - Keep sensitive tokens out of version control
   - Run authentication script for each account

## Troubleshooting

### Common Setup Issues

1. **Missing Configuration**
   - Error: "GOOGLE_CLIENT_ID environment variable is required"
   - Solution: Configure the OAuth credentials in your MCP settings file (see docs/API.md for details)

2. **Authentication Errors**
   - Error: "Invalid OAuth credentials"
   - Solution:
     - Verify your Google Cloud project is properly configured
     - Ensure you've added yourself as a test user in the OAuth consent screen
     - Check that both Gmail API and Google Calendar API are enabled
     - Verify credentials in MCP settings match your OAuth client configuration

3. **Token Issues**
   - Error: "Token refresh failed"
   - Solution: Remove the account using `remove_workspace_account` and re-authenticate
   - Check that your Google Cloud project has the necessary API scopes enabled

4. **Directory Structure**
   - Error: "Directory not found"
   - Solution: Ensure ~/.mcp/google-workspace-mcp exists with proper permissions
   - Verify Docker has access to mount the config directory

For additional help, consult the [Error Handling](docs/ERRORS.md) documentation.

## License

MIT License - See LICENSE file for details
