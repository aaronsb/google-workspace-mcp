# Google Workspace MCP Examples

This document provides examples of using the Google Workspace MCP tools.

## Account Management

```typescript
// List configured accounts
const accounts = await mcp.callTool('list_workspace_accounts', {});

// Authenticate a new account
const auth = await mcp.callTool('authenticate_workspace_account', {
  email: 'user@example.com'
});

// Remove an account
await mcp.callTool('remove_workspace_account', {
  email: 'user@example.com'
});
```

## Gmail Operations

### Messages

```typescript
// Search emails
const emails = await mcp.callTool('search_workspace_emails', {
  email: 'user@example.com',
  search: {
    from: 'sender@example.com',
    subject: 'Important Meeting',
    after: '2024-01-01',
    hasAttachment: true
  }
});

// Example response with simplified attachment format (v1.1)
{
  "emails": [{
    "id": "msg123",
    "subject": "Important Meeting",
    "from": "sender@example.com",
    "hasAttachment": true,
    "attachments": [{
      "name": "presentation.pdf"
    }]
  }]
}

// Send email
await mcp.callTool('send_workspace_email', {
  email: 'user@example.com',
  to: ['recipient@example.com'],
  subject: 'Hello',
  body: 'Message content'
});
```

### Labels

```typescript
// Create label
await mcp.callTool('manage_workspace_label', {
  email: 'user@example.com',
  action: 'create',
  data: {
    name: 'Projects/Active',
    labelListVisibility: 'labelShow',
    messageListVisibility: 'show'
  }
});

// Apply label to message
await mcp.callTool('manage_workspace_label_assignment', {
  email: 'user@example.com',
  action: 'add',
  messageId: 'msg123',
  labelIds: ['label123']
});
```

### Drafts

```typescript
// Create draft
const draft = await mcp.callTool('manage_workspace_draft', {
  email: 'user@example.com',
  action: 'create',
  data: {
    to: ['recipient@example.com'],
    subject: 'Draft Message',
    body: 'Draft content'
  }
});

// Send draft
await mcp.callTool('manage_workspace_draft', {
  email: 'user@example.com',
  action: 'send',
  draftId: draft.id
});
```

## Calendar Operations

### Events

```typescript
// List calendar events
const events = await mcp.callTool('list_workspace_calendar_events', {
  email: 'user@example.com',
  timeMin: '2024-02-01T00:00:00Z',
  timeMax: '2024-02-28T23:59:59Z'
});

// Create event
await mcp.callTool('create_workspace_calendar_event', {
  email: 'user@example.com',
  summary: 'Team Meeting',
  start: {
    dateTime: '2024-02-20T10:00:00-06:00',
    timeZone: 'America/Chicago'
  },
  end: {
    dateTime: '2024-02-20T11:00:00-06:00',
    timeZone: 'America/Chicago'
  },
  attendees: [
    { email: 'teammate@example.com' }
  ]
});

// Respond to event
await mcp.callTool('manage_workspace_calendar_event', {
  email: 'user@example.com',
  eventId: 'evt123',
  action: 'accept',
  comment: 'Looking forward to it!'
});
```

## Drive Operations

### File Management

```typescript
// List files
const files = await mcp.callTool('list_drive_files', {
  email: 'user@example.com',
  options: {
    folderId: 'folder123',
    pageSize: 100
  }
});

// Search files
const searchResults = await mcp.callTool('search_drive_files', {
  email: 'user@example.com',
  options: {
    fullText: 'project proposal',
    mimeType: 'application/pdf'
  }
});

// Upload file
const uploadedFile = await mcp.callTool('upload_drive_file', {
  email: 'user@example.com',
  options: {
    name: 'document.pdf',
    content: 'base64_encoded_content',
    mimeType: 'application/pdf',
    parents: ['folder123']
  }
});

// Download file
const fileContent = await mcp.callTool('download_drive_file', {
  email: 'user@example.com',
  fileId: 'file123',
  mimeType: 'application/pdf'  // For Google Workspace files
});

// Delete file
await mcp.callTool('delete_drive_file', {
  email: 'user@example.com',
  fileId: 'file123'
});
```

### Folder Operations

```typescript
// Create folder
const folder = await mcp.callTool('create_drive_folder', {
  email: 'user@example.com',
  name: 'Project Documents',
  parentId: 'parent123'  // Optional
});
```

### Permissions

```typescript
// Update file permissions
await mcp.callTool('update_drive_permissions', {
  email: 'user@example.com',
  options: {
    fileId: 'file123',
    role: 'writer',
    type: 'user',
    emailAddress: 'collaborator@example.com'
  }
});

// Share with domain
await mcp.callTool('update_drive_permissions', {
  email: 'user@example.com',
  options: {
    fileId: 'file123',
    role: 'reader',
    type: 'domain',
    domain: 'example.com'
  }
});
