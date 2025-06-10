# Google Workspace MCP Server

![Robot Assistant](https://raw.githubusercontent.com/aaronsb/google-workspace-mcp/main/docs/assets/robot-assistant.png)

This Model Context Protocol (MCP) server puts you in control of your Google Workspace. Once you connect your account - a simple, secure process that takes just a minute - you're ready to go. Behind the scenes, it keeps your connection safe and active, so you can focus on getting things done instead of managing logins and permissions.

Take command of your Gmail inbox in ways you never thought possible. Want that proposal from last quarter? Found in seconds. Drowning in newsletters? They'll sort themselves into folders automatically. Need to track responses to an important thread? Labels and filters do the work for you. From drafting the perfect email to managing conversations with your team, everything just clicks into place. With streamlined attachment handling, you can easily find and manage email attachments while the system takes care of all the complex metadata behind the scenes.

Your calendar becomes a trusted ally in the daily juggle. No more double-booked meetings or timezone confusion. Planning a team sync? It spots the perfect time slots. Running a recurring workshop? Set it up once, and you're done. Even when plans change, finding new times that work for everyone is quick and painless. The days of endless "when are you free?" emails are over.

Turn Google Drive from a file dump into your digital command center. Every document finds its place, every folder tells a story. Share files with exactly the right people - no more "who can edit this?" confusion. Looking for that presentation from last week's meeting? Search not just names, but what's inside your files. Whether you're organizing a small project or managing a mountain of documents, everything stays right where you need it.

## Key Features

- **Gmail Management**: Search, send, organize emails with advanced filtering and label management
- **Calendar Operations**: Create, update, and manage events with full scheduling capabilities
- **Drive Integration**: Upload, download, search, and manage files with permission controls
- **Contact Access**: Retrieve and manage your Google contacts
- **Secure Authentication**: OAuth 2.0 flow with automatic token refresh
- **Multi-Account Support**: Manage multiple Google accounts simultaneously

## Quick Start

### Prerequisites

1. **Google Cloud Project Setup**:
   - Create a project in [Google Cloud Console](https://console.cloud.google.com)
   - Enable Gmail API, Calendar API, and Drive API
   - Configure OAuth consent screen as "External"
   - Add yourself as a test user

2. **OAuth Credentials**:
   - Create OAuth 2.0 credentials
   - Choose "Web application" type
   - Set redirect URI to: `http://localhost:8080`
   - Save your Client ID and Client Secret

3. **Local Setup**:
   - Install Docker
   - Create config directory: `mkdir -p ~/.mcp/google-workspace-mcp`
       - If the directory already exists, ensure your user owns it

### Configuration

Add the server to your MCP client configuration:

**For Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
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

**For Cline** (`~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`):
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

**Key Configuration Notes**:
- Port mapping `-p 8080:8080` is required for OAuth callback handling
- Replace placeholder credentials with your actual Google Cloud OAuth credentials
- The `LOG_MODE=strict` setting is recommended but not required

Logging modes:
- normal (default): Uses appropriate console methods for each log level
- strict: Routes all non-JSON-RPC messages to stderr

### Authentication

1. Restart your MCP client after configuration
2. Ask your AI assistant to "add my Google account"
3. Follow the OAuth flow:
   - Click the provided authorization URL
   - Sign in to Google and grant permissions
   - Copy the authorization code from the success page
   - Provide the code back to complete authentication

## Architecture

### OAuth Flow

The server implements a secure OAuth 2.0 flow:

1. **Callback Server**: Automatically starts on `localhost:8080` to handle OAuth redirects
2. **Authorization**: Generates Google OAuth URLs for user authentication
3. **Token Management**: Securely stores and automatically refreshes access tokens
4. **Multi-Account**: Supports multiple Google accounts with isolated token storage

### File Management

Files are organized in a structured workspace:

```
~/Documents/workspace-mcp-files/
├── [email@domain.com]/
│   ├── downloads/        # Files downloaded from Drive
│   └── uploads/         # Files staged for upload
├── [email2@domain.com]/
│   ├── downloads/
│   └── uploads/
└── shared/
    └── temp/           # Temporary files (auto-cleanup)
```

## Available Tools

### Account Management
- `list_workspace_accounts` - List configured accounts and authentication status
- `authenticate_workspace_account` - Add and authenticate Google accounts
- `remove_workspace_account` - Remove accounts and associated tokens

### Gmail Operations
- `search_workspace_emails` - Advanced email search with filtering
- `send_workspace_email` - Send emails with attachments and formatting
- `manage_workspace_draft` - Create, update, and manage email drafts
- `manage_workspace_label` - Create and manage Gmail labels
- `manage_workspace_label_assignment` - Apply/remove labels from messages
- `manage_workspace_label_filter` - Create automated label filters
- `get_workspace_gmail_settings` - Access Gmail account settings

### Calendar Operations
- `list_workspace_calendar_events` - List and search calendar events
- `get_workspace_calendar_event` - Get detailed event information
- `create_workspace_calendar_event` - Create new events with attendees
- `manage_workspace_calendar_event` - Update events and respond to invitations
- `delete_workspace_calendar_event` - Delete calendar events

### Drive Operations
- `list_drive_files` - List files with filtering and pagination
- `search_drive_files` - Full-text search across Drive content
- `upload_drive_file` - Upload files with metadata and permissions
- `download_drive_file` - Download files with format conversion
- `delete_drive_file` - Delete files and folders
- `create_drive_folder` - Create organized folder structures
- `update_drive_permissions` - Manage file sharing and permissions

### Contacts Operations
- `get_workspace_contacts` - Retrieve contact information and details

See [API Documentation](docs/API.md) for detailed usage examples.

## Development

### Local Development

For local development and testing:

```bash
# Clone the repository
git clone https://github.com/aaronsb/google-workspace-mcp.git
cd google-workspace-mcp

# Build local Docker image
./scripts/build-local.sh

# Use local image in configuration
# Replace "ghcr.io/aaronsb/google-workspace-mcp:latest" with "google-workspace-mcp:local"
```

## Troubleshooting

### Common Issues

**Authentication Errors**:
- Verify OAuth credentials are correctly configured
- Ensure APIs (Gmail, Calendar, Drive) are enabled in Google Cloud
- Check that you're added as a test user in OAuth consent screen
- Confirm redirect URI is set to `http://localhost:8080`

**Connection Issues**:
- Verify port 8080 is available and not blocked by firewall
- Ensure Docker has permission to bind to port 8080
- Check that config directory exists and has proper permissions

**Docker Issues**:
macOS:
- Shut down Docker fully from command line with `pkill -SIGHUP -f /Applications/Docker.app 'docker serve'`
- Restart Docker Desktop
- Restart your MCP client (Claude Desktop or Cursor/Cline/etc.)

Windows:
- Open Task Manager (Ctrl+Shift+Esc)
- Find and end the "Docker Desktop" process
- Restart Docker Desktop from the Start menu
- Restart your MCP client (Claude Desktop or Cursor/Cline/etc.)

**Token Issues**:
- Remove and re-authenticate accounts if tokens become invalid
- Verify API scopes are properly configured in Google Cloud
- Check token expiration and refresh logic

### Getting Help

For additional support:
- Check [Error Documentation](docs/ERRORS.md)
- Review [API Examples](docs/EXAMPLES.md)
- Submit issues on GitHub

## Security

- OAuth credentials are stored securely in MCP client configuration
- Access tokens are encrypted and stored locally
- Automatic token refresh prevents credential exposure
- Each user maintains their own Google Cloud Project
- No credentials are transmitted to external servers

## License

MIT License - See [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
