# Google API MCP Server Examples

## Basic Usage Examples

### 1. List Gmail Messages

```typescript
// List recent emails
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

### 2. Get Drive Files

```typescript
// List files in Google Drive
const response = await use_mcp_tool({
  server_name: "mcp-gsuite",
  tool_name: "google_api_request",
  arguments: {
    email: "user@example.com",
    api_endpoint: "drive.files.list",
    method: "GET",
    params: {
      pageSize: 10,
      fields: "files(id, name, mimeType, createdTime)"
    },
    required_scopes: [
      "https://www.googleapis.com/auth/drive.readonly"
    ]
  }
});
```

## Authentication Flow Examples

### 1. First-time Authentication

```typescript
// Initial request will return auth URL
const response = await use_mcp_tool({
  server_name: "mcp-gsuite",
  tool_name: "google_api_request",
  arguments: {
    email: "user@example.com",
    api_endpoint: "gmail.users.messages.list",
    method: "GET",
    params: {
      userId: "me"
    },
    required_scopes: [
      "https://www.googleapis.com/auth/gmail.readonly"
    ]
  }
});

// Response will include auth URL and instructions
{
  status: "auth_required",
  auth_url: "https://accounts.google.com/o/oauth2/...",
  message: "Please complete authentication:",
  instructions: "1. Click the authorization URL..."
}

// After getting auth code, retry with code
const authResponse = await use_mcp_tool({
  server_name: "mcp-gsuite",
  tool_name: "google_api_request",
  arguments: {
    email: "user@example.com",
    api_endpoint: "gmail.users.messages.list",
    method: "GET",
    params: {
      userId: "me"
    },
    required_scopes: [
      "https://www.googleapis.com/auth/gmail.readonly"
    ],
    auth_code: "4/P7q7W91a-oMsCeLvIaQm6bTrgtp7"
  }
});
```

### 2. Token Refresh Flow

```typescript
// If token expires, server handles refresh automatically
const response = await use_mcp_tool({
  server_name: "mcp-gsuite",
  tool_name: "google_api_request",
  arguments: {
    email: "user@example.com",
    api_endpoint: "gmail.users.messages.list",
    method: "GET",
    params: {
      userId: "me"
    },
    required_scopes: [
      "https://www.googleapis.com/auth/gmail.readonly"
    ]
  }
});

// If token needs refresh, you'll get:
{
  status: "refreshing",
  message: "Token refreshed successfully, please retry the request"
}

// Simply retry the original request
```

## Advanced Usage Examples

### 1. Gmail: Send Email

```typescript
const response = await use_mcp_tool({
  server_name: "mcp-gsuite",
  tool_name: "google_api_request",
  arguments: {
    email: "user@example.com",
    api_endpoint: "gmail.users.messages.send",
    method: "POST",
    params: {
      userId: "me",
      message: {
        raw: Base64.encode(`
          From: user@example.com
          To: recipient@example.com
          Subject: Test Email

          This is a test email.
        `)
      }
    },
    required_scopes: [
      "https://www.googleapis.com/auth/gmail.send"
    ]
  }
});
```

### 2. Drive: Search Files

```typescript
const response = await use_mcp_tool({
  server_name: "mcp-gsuite",
  tool_name: "google_api_request",
  arguments: {
    email: "user@example.com",
    api_endpoint: "drive.files.list",
    method: "GET",
    params: {
      q: "mimeType='application/pdf' and modifiedTime > '2024-01-01'",
      spaces: "drive",
      fields: "files(id, name, mimeType, modifiedTime)",
      pageSize: 100
    },
    required_scopes: [
      "https://www.googleapis.com/auth/drive.readonly"
    ]
  }
});
```

## Error Handling Examples

### 1. Handle Missing Parameters

```typescript
try {
  const response = await use_mcp_tool({
    server_name: "mcp-gsuite",
    tool_name: "google_api_request",
    arguments: {
      email: "user@example.com",
      api_endpoint: "gmail.users.messages.get",
      method: "GET",
      params: {
        userId: "me"
        // Missing required 'id' parameter
      },
      required_scopes: [
        "https://www.googleapis.com/auth/gmail.readonly"
      ]
    }
  });
} catch (error) {
  // Handle MISSING_REQUIRED_PARAMS error
  console.error("Missing parameters:", error.resolution);
}
```

### 2. Handle Invalid Service

```typescript
try {
  const response = await use_mcp_tool({
    server_name: "mcp-gsuite",
    tool_name: "google_api_request",
    arguments: {
      email: "user@example.com",
      api_endpoint: "invalid.service.method", // Invalid service
      method: "GET",
      params: {},
      required_scopes: []
    }
  });
} catch (error) {
  // Handle INVALID_SERVICE error
  console.error("Invalid service:", error.resolution);
}
```

## Best Practices Examples

### 1. Minimal Scopes

```typescript
// Good: Request only needed scope
const response = await use_mcp_tool({
  server_name: "mcp-gsuite",
  tool_name: "google_api_request",
  arguments: {
    email: "user@example.com",
    api_endpoint: "drive.files.list",
    method: "GET",
    params: {
      fields: "files(id, name)"
    },
    required_scopes: [
      "https://www.googleapis.com/auth/drive.readonly" // Read-only scope
    ]
  }
});
```

### 2. Error Handling with Retry

```typescript
const makeRequest = async (retries = 3) => {
  try {
    const response = await use_mcp_tool({
      server_name: "mcp-gsuite",
      tool_name: "google_api_request",
      arguments: {
        email: "user@example.com",
        api_endpoint: "gmail.users.messages.list",
        method: "GET",
        params: {
          userId: "me"
        },
        required_scopes: [
          "https://www.googleapis.com/auth/gmail.readonly"
        ]
      }
    });
    return response;
  } catch (error) {
    if (retries > 0 && error.status === "error") {
      // Retry on certain errors
      if (["API_ERROR_429", "API_ERROR_500", "API_ERROR_503"].includes(error.code)) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return makeRequest(retries - 1);
      }
    }
    throw error;
  }
};
