# Google Workspace MCP Server - AI Assistant Installation Guide

This guide provides step-by-step instructions for setting up the Google Workspace MCP server with AI assistants like Claude Desktop and Cline.

## Overview

The Google Workspace MCP server enables AI assistants to interact with your Google Workspace services (Gmail, Calendar, Drive, Contacts) through a secure OAuth 2.0 authentication flow. The server runs in a Docker container and handles all API interactions.

## Prerequisites

### System Requirements
- Docker installed and running
- Internet connection for Google API access
- Available port 8080 for OAuth callback handling

### Google Cloud Setup

1. **Create Google Cloud Project**:
   - Visit [Google Cloud Console](https://console.cloud.google.com)
   - Create a new project or select an existing one
   - Note your project ID for reference

2. **Enable Required APIs**:
   Navigate to "APIs & Services" > "Library" and enable:
   - Gmail API
   - Google Calendar API
   - Google Drive API
   - People API (for Contacts)

3. **Configure OAuth Consent Screen**:
   - Go to "APIs & Services" > "OAuth consent screen"
   - Choose "External" user type
   - Fill in required application information:
     - App name: "Google Workspace MCP Server" (or your preference)
     - User support email: Your email address
     - Developer contact information: Your email address
   - Add yourself as a test user in the "Test users" section

4. **Create OAuth 2.0 Credentials**:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth 2.0 Client IDs"
   - **Important**: Select "Web application" (not Desktop application)
   - Set application name: "Google Workspace MCP Server"
   - Add authorized redirect URI: `http://localhost:8080`
   - Save and note your Client ID and Client Secret

## Installation Steps

### Step 1: Create Configuration Directory

Create a local directory for storing authentication tokens:

```bash
mkdir -p ~/.mcp/google-workspace-mcp
```

### Step 2: Configure Your MCP Client

Choose the appropriate configuration for your AI assistant:

#### For Claude Desktop

Edit your Claude Desktop configuration file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Add the following configuration:

```json
{
  "mcpServers": {
    "google-workspace-mcp": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-p", "8080:8080",
        "-v", "~/.mcp/google-workspace-mcp:/app/config",
        "-v", "~/Documents/workspace-mcp-files:/app/workspace",
        "-e", "GOOGLE_CLIENT_ID",
        "-e", "GOOGLE_CLIENT_SECRET",
        "-e", "LOG_MODE=strict",
        "ghcr.io/aaronsb/google-workspace-mcp:latest"
      ],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

#### For Cline (VS Code Extension)

Edit your Cline MCP settings file:
`~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`

```json
{
  "mcpServers": {
    "google-workspace-mcp": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-p", "8080:8080",
        "-v", "~/.mcp/google-workspace-mcp:/app/config",
        "-v", "~/Documents/workspace-mcp-files:/app/workspace",
        "-e", "GOOGLE_CLIENT_ID",
        "-e", "GOOGLE_CLIENT_SECRET",
        "-e", "LOG_MODE=strict",
        "ghcr.io/aaronsb/google-workspace-mcp:latest"
      ],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

**Important Configuration Notes**:
- Replace `your-client-id.apps.googleusercontent.com` with your actual Google OAuth Client ID
- Replace `your-client-secret` with your actual Google OAuth Client Secret
- The `-p 8080:8080` port mapping is required for OAuth callback handling
- Adjust volume paths if you prefer different local directories

### Step 3: Restart Your AI Assistant

After updating the configuration:
- **Claude Desktop**: Completely quit and restart the application
- **Cline**: Restart VS Code or reload the Cline extension

## Authentication Process

### Initial Account Setup

1. **Start Authentication**:
   Ask your AI assistant: "Add my Google account" or "Set up Google Workspace access"

2. **OAuth Flow**:
   - The assistant will provide a Google authorization URL
   - Click the URL to open it in your browser
   - Sign in to your Google account
   - Review and accept the requested permissions
   - You'll be redirected to a success page showing your authorization code

3. **Complete Authentication**:
   - Copy the authorization code from the success page
   - Provide the code back to your AI assistant
   - The assistant will complete the authentication and save your tokens

### Managing Multiple Accounts

You can authenticate multiple Google accounts:
- Each account is stored separately with its own tokens
- Use account categorization (e.g., "work", "personal") for organization
- Switch between accounts as needed for different operations

## Verification

### Test Your Setup

After authentication, verify the setup works:

1. **List Accounts**: Ask "List my Google accounts" to see authenticated accounts
2. **Test Gmail**: Ask "Show me my recent emails"
3. **Test Calendar**: Ask "What's on my calendar today?"
4. **Test Drive**: Ask "List files in my Google Drive"

### Common Usage Examples

- "Search for emails from john@company.com in the last week"
- "Create a calendar event for tomorrow at 2 PM"
- "Upload this document to my Google Drive"
- "Show me my contacts with 'Smith' in the name"

## Troubleshooting

### Authentication Issues

**Problem**: "Invalid OAuth credentials" error
**Solution**:
- Verify Client ID and Client Secret are correctly copied
- Ensure OAuth consent screen is properly configured
- Check that you're added as a test user

**Problem**: "Connection refused" on localhost:8080
**Solution**:
- Verify port 8080 is not blocked by firewall
- Ensure Docker has permission to bind to port 8080
- Check that no other service is using port 8080

### Configuration Issues

**Problem**: MCP server not starting
**Solution**:
- Verify Docker is running

   macOS:
   - Shut down Docker fully from command line with `pkill -SIGHUP -f /Applications/Docker.app 'docker serve'`
   - Restart Docker Desktop
   - Restart your MCP client (Claude Desktop or Cursor/Cline/etc.)

   Windows:
   - Open Task Manager (Ctrl+Shift+Esc)
   - Find and end the "Docker Desktop" process
   - Restart Docker Desktop from the Start menu
   - Restart your MCP client (Claude Desktop or Cursor/Cline/etc.)

- Check that configuration directory exists and has proper permissions
- Ensure Docker image can be pulled from registry

**Problem**: "Directory not found" errors
**Solution**:
- Create the config directory: `mkdir -p ~/.mcp/google-workspace-mcp`
- Verify volume mount paths in configuration are correct
- Check file permissions on mounted directories

### API Issues

**Problem**: "API not enabled" errors
**Solution**:
- Verify all required APIs are enabled in Google Cloud Console
- Wait a few minutes after enabling APIs for changes to propagate
- Check API quotas and limits in Google Cloud Console

## Security Best Practices

1. **Credential Management**:
   - Store OAuth credentials securely in MCP configuration
   - Never commit credentials to version control
   - Regularly rotate OAuth client secrets

2. **Access Control**:
   - Use minimal required API scopes
   - Regularly review and audit account access
   - Remove unused accounts from authentication

3. **Network Security**:
   - OAuth callback server only runs during authentication
   - All API communication uses HTTPS
   - Tokens are stored locally and encrypted

## Advanced Configuration

### Custom File Workspace

To use a different directory for file operations:

```json
"args": [
  "run",
  "--rm",
  "-i",
  "-p", "8080:8080",
  "-v", "~/.mcp/google-workspace-mcp:/app/config",
  "-v", "/path/to/your/workspace:/app/workspace",
  "-e", "WORKSPACE_BASE_PATH=/app/workspace",
  "ghcr.io/aaronsb/google-workspace-mcp:latest"
]
```

### Logging Configuration

For debugging, you can adjust logging levels:

```json
"env": {
  "GOOGLE_CLIENT_ID": "your-client-id",
  "GOOGLE_CLIENT_SECRET": "your-client-secret",
  "LOG_MODE": "normal",
  "LOG_LEVEL": "debug"
}
```

## Getting Help

If you encounter issues:

1. Check the [main documentation](README.md) for additional troubleshooting
2. Review [error documentation](docs/ERRORS.md) for specific error codes
3. Examine Docker logs: `docker logs <container-id>`
4. Submit issues on the project's GitHub repository

## Next Steps

Once setup is complete:
- Explore the [API documentation](docs/API.md) for detailed tool usage
- Review [examples](docs/EXAMPLES.md) for common use cases
- Consider setting up multiple accounts for different workflows
