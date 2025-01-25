# Google Services MCP Server

A Model Context Protocol (MCP) server that provides tools and resources for interacting with Google services (GSuite, Gmail, Drive, etc.) through secure OAuth authentication.

## Features

- 🔐 Secure OAuth 2.0 device code flow
- 📦 Environment-based credential management
- 🔄 Automatic token refresh handling
- 👥 Multi-account support
- 🛡️ Scope-based access control
- 🌐 Simple copy/paste authentication

## Prerequisites

- Node.js >= 18
- npm >= 9
- Google Cloud Console project with OAuth 2.0 credentials

## Setup

1. Clone the repository:
```bash
git clone [repository-url]
cd mcp-gsuite-new
```

2. Install dependencies:
```bash
npm install
```

3. Configure Google OAuth:

   a. Create a project in [Google Cloud Console](https://console.cloud.google.com)
   b. Enable desired APIs (Gmail, Drive, etc.)
   c. Create OAuth 2.0 credentials
   d. Download credentials and save as `config/gauth.json` (or specify location with GAUTH_FILE env var)
   e. Create `config/accounts.json` (or specify location with ACCOUNTS_FILE env var) with your account configuration:
   ```json
   {
     "accounts": [
       {
         "email": "your.email@gmail.com",
         "category": "work",
         "description": "Work account"
       }
     ]
   }
   ```

4. Run setup:
```bash
npm run setup
```

5. Build and start the server:
```bash
npm run build
npm start
```

## Configuration

The server can be configured using environment variables:

- `GAUTH_FILE` - Path to Google OAuth credentials file (default: `config/gauth.json`)
- `ACCOUNTS_FILE` - Path to accounts configuration file (default: `config/accounts.json`)
- `CREDENTIALS_DIR` - Directory for storing OAuth tokens (default: `config/credentials`)

## Usage

The server provides MCP tools for:
- Authenticating Google accounts
- Managing OAuth tokens
- Making authenticated API requests
- Handling token refresh

Example tool usage:
```typescript
// Initial request
const result = await mcp.useTool('google_api_request', {
  email: 'your.email@gmail.com',
  api_endpoint: 'gmail.users.messages.list',
  method: 'GET',
  required_scopes: ['https://www.googleapis.com/auth/gmail.readonly']
});

// If authentication is needed, you'll receive instructions:
// 1. Open the provided auth URL in your browser
// 2. Complete the Google sign-in process
// 3. Copy the authorization code
// 4. Retry the request with the auth code:
const authenticatedResult = await mcp.useTool('google_api_request', {
  email: 'your.email@gmail.com',
  api_endpoint: 'gmail.users.messages.list',
  method: 'GET',
  required_scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  auth_code: 'paste-your-auth-code-here'
});
```

## Development

- `npm run build` - Build the project
- `npm run watch` - Watch mode during development
- `npm run setup` - Configure Google environment
- `npm start` - Start the MCP server

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed system design.

## Roadmap

See [TODO.md](./TODO.md) for planned improvements.

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT
