# Google API MCP Server

A Model Context Protocol (MCP) server that provides authenticated access to Google APIs. This server handles OAuth authentication, token management, and request validation for Google services like Gmail and Drive.

## Features

- **Standardized Interface**: Consistent request/response format for all Google APIs
- **OAuth Authentication**: Handles the complete OAuth flow including token refresh
- **Request Validation**: Validates endpoints, parameters, and scopes before making requests
- **Error Handling**: Comprehensive error handling with clear messages and resolution steps
- **Multiple Services**: Support for Gmail, Drive, and other Google services

## Supported Services

- **Gmail**: Email operations (list, get, send messages)
- **Drive**: File operations (list, get, create, update files)
- More services coming soon...

## Documentation

- [API Documentation](docs/API.md): Detailed API reference
- [Error Handling](docs/ERRORS.md): Error codes and resolution steps
- [Usage Examples](docs/EXAMPLES.md): Code examples and best practices

## Quick Start

1. **Installation**
   ```bash
   npm install @modelcontextprotocol/sdk
   ```

2. **Configuration**
   - Set up Google OAuth credentials
   - Configure the MCP server settings

3. **Basic Usage**
   ```typescript
   const response = await use_mcp_tool({
     server_name: "mcp-gsuite",
     tool_name: "google_api_request",
     arguments: {
       email: "user@example.com",
       api_endpoint: "gmail.users.messages.list",
       method: "GET",
       params: {
         userId: "me",
         maxResults: 10
       },
       required_scopes: [
         "https://www.googleapis.com/auth/gmail.readonly"
       ]
     }
   });
   ```

## Architecture

The server follows a modular architecture with clear separation of concerns:

- **Request Handler**: Manages the request lifecycle
- **Endpoint Validator**: Validates API endpoints and methods
- **Parameter Validator**: Validates request parameters
- **OAuth Client**: Handles authentication flows
- **Token Manager**: Manages OAuth tokens
- **Account Manager**: Handles user account management

## Error Handling

The server provides detailed error information:

```typescript
{
  status: "error",
  error: "Detailed error message",
  resolution: "Steps to resolve the error"
}
```

See [Error Documentation](docs/ERRORS.md) for more details.

## Best Practices

1. **Minimal Scopes**: Request only the scopes needed
2. **Error Handling**: Implement proper error handling
3. **Token Management**: Handle token refresh flows
4. **Parameter Validation**: Validate parameters before sending
5. **Rate Limiting**: Implement retry logic with backoff

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - See LICENSE file for details
