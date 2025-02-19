# Google Workspace MCP Installation Guide

This guide will help you install and configure the Google Workspace MCP server for managing Gmail and Calendar operations.

## Requirements

- Docker installed and running
- Access to create a Google Cloud Project
- Local directory for configuration storage

## Installation Steps

1. First, I'll help create a Google Cloud Project and obtain the necessary credentials:
   ```
   1. Go to Google Cloud Console (https://console.cloud.google.com)
   2. Create a new project
   3. Enable the Gmail API and Google Calendar API
   4. Configure OAuth consent screen:
      - Set as "External"
      - Add the user as a test user
   5. Create OAuth 2.0 credentials:
      - Choose "Desktop application" type
      - Use "urn:ietf:wg:oauth:2.0:oob" as redirect URI
      - Save the Client ID and Client Secret
   ```

2. I'll create the required configuration directory:
   ```bash
   mkdir -p ~/.mcp/google-workspace-mcp
   ```

3. I'll add the MCP server configuration to the appropriate settings file:
   - For VSCode Cline: `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
   - For Claude desktop: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or appropriate path for other OS

   ```json
   {
     "mcpServers": {
       "google-workspace-mcp": {
         "command": "docker",
         "args": [
           "run",
           "--rm",
           "-i",
           "-v", "~/.mcp/google-workspace-mcp:/app/config",
           "-e", "GOOGLE_CLIENT_ID",
           "-e", "GOOGLE_CLIENT_SECRET",
           "-e", "LOG_MODE=strict",
           "ghcr.io/aaronsb/google-workspace-mcp:latest"
         ],
         "env": {
           "GOOGLE_CLIENT_ID": "[CLIENT_ID]",
           "GOOGLE_CLIENT_SECRET": "[CLIENT_SECRET]"
         },
         "autoApprove": [],
         "disabled": false
       }
     }
   }
   ```

4. After configuration, I'll help authenticate Google accounts:
   ```
   1. I'll use list_workspace_accounts to check the current state
   2. For each account to add:
      - I'll use authenticate_workspace_account
      - I'll provide an auth URL for the user to complete OAuth flow
      - I'll help process the returned authorization code
   ```

## Troubleshooting

If you encounter any issues during installation, I can help with:

1. Missing configuration errors:
   - Verify Google Cloud credentials are properly configured
   - Check configuration directory exists and has correct permissions

2. Authentication errors:
   - Confirm Gmail and Calendar APIs are enabled
   - Verify OAuth consent screen configuration
   - Ensure user is added as test user

3. Token issues:
   - I can help remove and re-authenticate accounts
   - Verify API scopes are properly enabled

## Security Notes

- Store credentials securely in MCP settings
- Never commit sensitive files to version control
- Use proper file permissions for config directory
- Keep tokens secure and rotate regularly

## Usage

After installation, I can help with:
- Managing Gmail operations (search, send, drafts, labels)
- Calendar operations (events, scheduling, responses)
- Account management (add, remove, authenticate)
