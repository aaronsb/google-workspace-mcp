# Google Workspace MCP Server Examples

IMPORTANT: Before using these examples, you must set up your own Google Cloud Project with access to Google Workspace APIs. See the [Setup Guide](API.md#setup-guide) for detailed instructions on:
- Creating a Google Cloud Project
- Enabling required APIs
- Configuring the OAuth consent screen
- Creating OAuth 2.0 credentials
- Setting up out-of-band authentication

## Account Management Examples

### 1. List Workspace Accounts

```typescript
// List all configured accounts and their status
const response = await use_mcp_tool({
  server_name: "google-workspace-mcp",
  tool_name: "list_workspace_accounts",
  arguments: {}
});

// Example response:
[
  {
    "email": "example.user@example.com",
    "category": "work",
    "description": "Example Work Account",
    "auth_status": {
      "has_token": true,
      "scopes": [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/drive.readonly"
      ],
      "expires": 1737845044927
    }
  }
]
```

## Authentication Flow Examples

### 1. First-time Account Authentication

```typescript
// Initial authentication request
const response = await use_mcp_tool({
  server_name: "google-workspace-mcp",
  tool_name: "authenticate_workspace_account",
  arguments: {
    email: "your.email@example.com",
    category: "work",
    description: "Work Google Account",
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
  instructions: [
    "1. Click the authorization URL below to open Google sign-in",
    "2. Sign in with your Google account",
    "3. Allow the requested permissions",
    "4. Copy the authorization code shown",
    "5. Run this request again with the auth_code parameter set to the code you copied"
  ].join("\n")
}

// Complete authentication with auth code
const authResponse = await use_mcp_tool({
  server_name: "google-workspace-mcp",
  tool_name: "authenticate_workspace_account",
  arguments: {
    email: "your.email@example.com",
    required_scopes: [
      "https://www.googleapis.com/auth/gmail.readonly"
    ],
    auth_code: "PASTE_AUTH_CODE_HERE"  // Replace with the actual code from OAuth consent screen
  }
});
```

### 2. Adding New Scopes

```typescript
// Request additional scopes for existing account
const response = await use_mcp_tool({
  server_name: "google-workspace-mcp",
  tool_name: "authenticate_workspace_account",
  arguments: {
    email: "your.email@example.com",
    required_scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/drive.readonly" // New scope
    ]
  }
});

// If new scopes require re-authentication:
{
  status: "auth_required",
  auth_url: "https://accounts.google.com/o/oauth2/...",
  message: "Additional permissions required. Please complete authentication:",
  instructions: "..."
}
```

## Error Handling Examples

### 1. Handle Invalid Email

```typescript
try {
  const response = await use_mcp_tool({
    server_name: "google-workspace-mcp",
    tool_name: "authenticate_workspace_account",
    arguments: {
      email: "invalid-email",
      required_scopes: []
    }
  });
} catch (error) {
  // Handle INVALID_EMAIL error
  console.error("Invalid email format:", error.resolution);
}
```

### 2. Handle Account Not Found

```typescript
try {
  const response = await use_mcp_tool({
    server_name: "google-workspace-mcp",
    tool_name: "authenticate_workspace_account",
    arguments: {
      email: "nonexistent.user@example.com",
      required_scopes: []
    }
  });
} catch (error) {
  // Handle ACCOUNT_NOT_FOUND error
  console.error("Account not found:", error.resolution);
}
```

## Best Practices Examples

### 1. Check Account Status Before Authentication

```typescript
// First check existing accounts
const listResponse = await use_mcp_tool({
  server_name: "google-workspace-mcp",
  tool_name: "list_workspace_accounts",
  arguments: {}
});

// Find account if it exists
const account = listResponse.find(acc => acc.email === "your.email@example.com");

if (account && account.auth_status.has_token) {
  // Check if we have all required scopes
  const hasAllScopes = requiredScopes.every(
    scope => account.auth_status.scopes.includes(scope)
  );
  
  if (hasAllScopes) {
    console.log("Account already authenticated with required scopes");
    return;
  }
}

// Proceed with authentication if needed
const authResponse = await use_mcp_tool({
  server_name: "google-workspace-mcp",
  tool_name: "authenticate_workspace_account",
  arguments: {
    email: "your.email@example.com",
    required_scopes: requiredScopes
  }
});
```

### 2. Error Handling with Retry

```typescript
const authenticateWithRetry = async (email, scopes, retries = 3) => {
  try {
    const response = await use_mcp_tool({
      server_name: "google-workspace-mcp",
      tool_name: "authenticate_workspace_account",
      arguments: {
        email,
        required_scopes: scopes
      }
    });
    return response;
  } catch (error) {
    if (retries > 0 && error.status === "error") {
      // Retry on certain errors
      if (["TOKEN_SAVE_ERROR", "TOKEN_LOAD_ERROR"].includes(error.code)) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return authenticateWithRetry(email, scopes, retries - 1);
      }
    }
    throw error;
  }
};
