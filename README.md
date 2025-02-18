# Google Workspace MCP Server

[![smithery badge](https://smithery.ai/badge/@aaronsb/google-workspace-mcp)](https://smithery.ai/server/@aaronsb/google-workspace-mcp)
[![glama badge](https://glama.ai/mcp/servers/0finyxgwlk/badge)](https://glama.ai/mcp/servers/0finyxgwlk)

A Model Context Protocol (MCP) server that provides authenticated access to Google Workspace APIs, offering comprehensive Gmail and Calendar functionality.

## TL;DR Setup

1. Create Google Cloud Project:
   ```bash
   # Go to Google Cloud Console
   https://console.cloud.google.com
   → Create Project
   → Enable Gmail API and Calendar API
   → Configure OAuth consent screen (External)
   → Create OAuth Desktop Client ID and Secret
   ```

2. Create config directory:
   ```bash
   mkdir -p ~/.mcp/google-workspace-mcp
   ```

3. Add to Cline settings (e.g., `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`):
   ```json
   {
     "mcpServers": {
       "google-workspace-mcp": {
         "command": "docker",
         "args": [
           "run", "--rm", "-i",
           "-v", "${HOME}/.mcp/google-workspace-mcp:/app/config",
           "-e", "GOOGLE_CLIENT_ID",
           "-e", "GOOGLE_CLIENT_SECRET",
           "ghcr.io/aaronsb/google-workspace-mcp:latest"
         ],
         "env": {
           "GOOGLE_CLIENT_ID": "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com",
           "GOOGLE_CLIENT_SECRET": "YOUR_CLIENT_SECRET_HERE",
           "LOG_MODE": "strict"  // For Claude desktop compatibility
         },
         "autoApprove": [],
         "disabled": false
       }
     }
   }
   ```

   Logging modes:
   - `normal` (default): Uses appropriate console methods for each log level
   - `strict`: Routes all non-JSON-RPC messages to stderr (recommended for Claude desktop)

4. Restart Cline/Claude

5. Just ask the AI to "add my Google account" - it will guide you through the authentication process conversationally.

See [detailed setup guide](#prerequisites) for more information.

## Prerequisites

Before using this MCP server, you must set up your own Google Cloud Project with access to Google Workspace APIs:

1. Create a new project in [Google Cloud Console](https://console.cloud.google.com)
2. Enable the required APIs:
   - Gmail API
   - Google Calendar API
3. Configure the OAuth consent screen:
   - Set up as "External"
   - Add yourself as a test user
   - Add required scopes for Gmail and Calendar
4. Create OAuth 2.0 credentials:
   - Choose "Desktop application" type
   - Note your Client ID and Client Secret
   - Use "urn:ietf:wg:oauth:2.0:oob" as the redirect URI (this enables out-of-band authentication)

The MCP server requires:
1. Your Google OAuth Client ID and Secret from the steps above
2. Local directory path for storing configuration (recommended: `~/.mcp/google-workspace-mcp`)

Note: This server uses out-of-band (OOB) authentication flow, which means you'll need to manually copy-paste authorization codes during the initial setup of each account.

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

### Manual Usage

You can also run the container directly:

```bash
docker run -i --rm \
  -v ~/.mcp/google-workspace-mcp:/app/config \
  -e GOOGLE_CLIENT_ID=YOUR_CLIENT_ID_HERE.apps.googleusercontent.com \
  -e GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET_HERE \
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
  -e GOOGLE_CLIENT_ID=YOUR_CLIENT_ID_HERE \
  -e GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET_HERE \
  -e GOOGLE_REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob \
  google-workspace-mcp:local
```

## Available Tools

### Account Management
- `list_workspace_accounts`: List all configured Google accounts and their authentication status
- `authenticate_workspace_account`: Add and authenticate a Google account for API access
- `remove_workspace_account`: Remove a Google account and delete its associated authentication tokens

### Gmail Operations
- `search_workspace_emails`: Search emails with advanced filtering (by sender, recipient, subject, content, date, labels, etc.)
- `send_workspace_email`: Send emails with support for CC/BCC recipients
- `get_workspace_gmail_settings`: Get Gmail settings and profile information
- `create_workspace_draft`: Create new email drafts with support for replies and threading
- `get_workspace_drafts`: Get a list of email drafts
- `send_workspace_draft`: Send an existing draft

### Calendar Operations
- `list_workspace_calendar_events`: Get calendar events with optional filtering by date range and search terms
- `get_workspace_calendar_event`: Get detailed information about a specific calendar event
- `create_workspace_calendar_event`: Create new calendar events with optional attendees

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
