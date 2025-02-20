# Google Workspace MCP API Reference

## Account Management

### list_workspace_accounts
List all configured Google workspace accounts and their authentication status.

**Input Schema**: Empty object `{}`

**Output**: Array of account objects with authentication status

### authenticate_workspace_account
Add and authenticate a Google account for API access.

**Input Schema**:
```typescript
{
  email: string;          // Required: Email address to authenticate
  category?: string;      // Optional: Account category (e.g., work, personal)
  description?: string;   // Optional: Account description
  auth_code?: string;     // Optional: OAuth code for completing authentication
}
```

### remove_workspace_account
Remove a Google account and delete associated tokens.

**Input Schema**:
```typescript
{
  email: string;  // Required: Email address to remove
}
```

## Gmail Operations

### search_workspace_emails
Search emails with advanced filtering.

**Input Schema**:
```typescript
{
  email: string;           // Required: Gmail account email
  search?: {              // Optional: Search criteria
    from?: string | string[];
    to?: string | string[];
    subject?: string;
    content?: string;     // Complex Gmail query
    after?: string;       // YYYY-MM-DD
    before?: string;      // YYYY-MM-DD
    hasAttachment?: boolean;
    labels?: string[];
    excludeLabels?: string[];
    includeSpam?: boolean;
    isUnread?: boolean;
  };
  maxResults?: number;    // Optional: Max results to return
}
```

### send_workspace_email
Send an email.

**Input Schema**:
```typescript
{
  email: string;           // Required: Sender email
  to: string[];           // Required: Recipients
  subject: string;        // Required: Email subject
  body: string;           // Required: Email content
  cc?: string[];         // Optional: CC recipients
  bcc?: string[];        // Optional: BCC recipients
}
```

### manage_workspace_draft
Manage email drafts.

**Input Schema**:
```typescript
{
  email: string;          // Required: Gmail account
  action: 'create' | 'read' | 'update' | 'delete' | 'send';
  draftId?: string;      // Required for read/update/delete/send
  data?: {               // Required for create/update
    to?: string[];
    subject?: string;
    body?: string;
    cc?: string[];
    bcc?: string[];
    replyToMessageId?: string;
    threadId?: string;
  }
}
```

## Calendar Operations

### list_workspace_calendar_events
List calendar events.

**Input Schema**:
```typescript
{
  email: string;          // Required: Calendar owner email
  query?: string;        // Optional: Text search
  maxResults?: number;   // Optional: Max events to return
  timeMin?: string;      // Optional: Start time (ISO string)
  timeMax?: string;      // Optional: End time (ISO string)
}
```

### create_workspace_calendar_event
Create a calendar event.

**Input Schema**:
```typescript
{
  email: string;          // Required: Calendar owner
  summary: string;        // Required: Event title
  description?: string;   // Optional: Event description
  start: {               // Required: Start time
    dateTime: string;    // ISO-8601 format
    timeZone?: string;   // IANA timezone
  };
  end: {                 // Required: End time
    dateTime: string;    // ISO-8601 format
    timeZone?: string;   // IANA timezone
  };
  attendees?: {          // Optional: Event attendees
    email: string;
  }[];
  recurrence?: string[]; // Optional: RRULE strings
}
```

## Drive Operations

### list_drive_files
List files in Google Drive.

**Input Schema**:
```typescript
{
  email: string;           // Required: Drive account email
  options?: {             // Optional: List options
    folderId?: string;    // Filter by parent folder
    query?: string;       // Custom query string
    pageSize?: number;    // Max files to return
    orderBy?: string[];   // Sort fields
    fields?: string[];    // Response fields to include
  }
}
```

### search_drive_files
Search files with advanced filtering.

**Input Schema**:
```typescript
{
  email: string;           // Required: Drive account email
  options: {              // Required: Search options
    fullText?: string;    // Full text search
    mimeType?: string;    // Filter by file type
    folderId?: string;    // Filter by parent folder
    trashed?: boolean;    // Include trashed files
    query?: string;       // Additional query string
    pageSize?: number;    // Max results
    orderBy?: string[];   // Sort order
    fields?: string[];    // Response fields
  }
}
```

### upload_drive_file
Upload a file to Drive.

**Input Schema**:
```typescript
{
  email: string;           // Required: Drive account email
  options: {              // Required: Upload options
    name: string;         // Required: File name
    content: string;      // Required: File content (string/base64)
    mimeType?: string;    // Optional: Content type
    parents?: string[];   // Optional: Parent folder IDs
  }
}
```

### download_drive_file
Download a file from Drive.

**Input Schema**:
```typescript
{
  email: string;           // Required: Drive account email
  fileId: string;         // Required: File to download
  mimeType?: string;      // Optional: Export format for Google files
}
```

### create_drive_folder
Create a new folder.

**Input Schema**:
```typescript
{
  email: string;           // Required: Drive account email
  name: string;           // Required: Folder name
  parentId?: string;      // Optional: Parent folder ID
}
```

### update_drive_permissions
Update file/folder sharing settings.

**Input Schema**:
```typescript
{
  email: string;           // Required: Drive account email
  options: {              // Required: Permission options
    fileId: string;       // Required: File/folder ID
    role: 'owner' | 'organizer' | 'fileOrganizer' | 
          'writer' | 'commenter' | 'reader';
    type: 'user' | 'group' | 'domain' | 'anyone';
    emailAddress?: string; // Required for user/group
    domain?: string;      // Required for domain
    allowFileDiscovery?: boolean;
  }
}
```

### delete_drive_file
Delete a file or folder.

**Input Schema**:
```typescript
{
  email: string;           // Required: Drive account email
  fileId: string;         // Required: File/folder to delete
}
```

## Label Management

### manage_workspace_label
Manage Gmail labels.

**Input Schema**:
```typescript
{
  email: string;           // Required: Gmail account
  action: 'create' | 'read' | 'update' | 'delete';
  labelId?: string;       // Required for read/update/delete
  data?: {               // Required for create/update
    name?: string;       // Label name
    messageListVisibility?: 'show' | 'hide';
    labelListVisibility?: 'labelShow' | 'labelHide' | 'labelShowIfUnread';
    color?: {
      textColor?: string;
      backgroundColor?: string;
    }
  }
}
```

### manage_workspace_label_assignment
Manage label assignments.

**Input Schema**:
```typescript
{
  email: string;           // Required: Gmail account
  action: 'add' | 'remove';
  messageId: string;      // Required: Message to modify
  labelIds: string[];     // Required: Labels to add/remove
}
```

### manage_workspace_label_filter
Manage Gmail filters.

**Input Schema**:
```typescript
{
  email: string;           // Required: Gmail account
  action: 'create' | 'read' | 'update' | 'delete';
  filterId?: string;      // Required for update/delete
  labelId?: string;       // Required for create/update
  data?: {
    criteria?: {
      from?: string[];
      to?: string[];
      subject?: string;
      hasWords?: string[];
      doesNotHaveWords?: string[];
      hasAttachment?: boolean;
      size?: {
        operator: 'larger' | 'smaller';
        size: number;
      }
    };
    actions?: {
      addLabel: boolean;
      markImportant?: boolean;
      markRead?: boolean;
      archive?: boolean;
    }
  }
}
