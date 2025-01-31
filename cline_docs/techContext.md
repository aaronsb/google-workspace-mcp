# Technical Context

## Technologies Used
- TypeScript/Node.js for server implementation
- Google Workspace APIs (Gmail, Calendar)
- OAuth 2.0 for authentication
- Model Context Protocol (MCP) for AI integration

## Development Setup
1. **Required Configuration Files**
   - `config/gauth.json`: OAuth credentials
   - `config/accounts.json`: Account configurations
   - `config/credentials/`: Token storage

2. **Environment Variables**
   - AUTH_CONFIG_FILE: OAuth credentials path
   - ACCOUNTS_FILE: Account config path
   - CREDENTIALS_DIR: Token storage path

## Technical Constraints
1. **OAuth & Authentication**
   - Must handle token refresh flows
   - Requires proper scope management
   - Needs secure token storage

2. **API Limitations**
   - Gmail API rate limits
   - Calendar API quotas
   - OAuth token expiration

3. **Tool Registration**
   - Tools must be registered in both ListToolsRequestSchema and CallToolRequestSchema
   - Must follow verb-noun naming convention

4. **Error Handling**
   - Must handle auth errors (401/403)
   - Must implement automatic token refresh
   - Must provide clear error messages

5. **Security Requirements**
   - Secure credential storage
   - Token encryption
   - Environment-based configuration
   - No sensitive data in version control
