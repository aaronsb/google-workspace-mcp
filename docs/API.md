# Google Workspace MCP API Reference

IMPORTANT: Before using any service operations, you MUST call list_workspace_accounts first to:
1. Check for existing authenticated accounts
2. Determine which account to use if multiple exist
3. Verify required API scopes are authorized

## Account Management (Required First)

### list_workspace_accounts
List all configured Google workspace accounts and their authentication status. This tool MUST be called first before any other workspace operations.

**Input Schema**: Empty object `{}`

**Output**: Array of account objects with authentication status

**Common Response Patterns**:
- Valid account exists → Proceed with requested operation
- Multiple accounts exist → Ask user which to use
- Token expired → Proceed normally (auto-refresh occurs)
- No accounts exist → Start authentication flow

### authenticate_workspace_account
Add and authenticate a Google account for API access. Only use this tool if list_workspace_accounts shows no existing accounts or when using the account it seems to lack necessary auth scopes.

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

IMPORTANT: Before any Gmail operation:
1. Call list_workspace_accounts to verify account access
2. Confirm account if multiple exist
3. Check required scopes include Gmail access

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

**Best Practices**:
1. Suggest writing a draft first, then send the draft
2. Verify account access with list_workspace_accounts
3. Confirm sending account if multiple exist
4. Validate all recipient addresses
5. Check content for completeness

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
Manage email drafts with CRUD operations and sending.

**Operations**:
- create: Create a new draft
- read: Get a specific draft or list all drafts
- update: Modify an existing draft
- delete: Remove a draft
- send: Send an existing draft

**Features**:
- New email drafts
- Reply drafts with threading
- Draft modifications
- Draft sending

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

IMPORTANT: Before any Calendar operation:
1. Verify account access with list_workspace_accounts
2. Confirm calendar account if multiple exist
3. Check calendar access permissions

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

**Required Formats**:
- Times: ISO-8601 (e.g., "2024-02-18T15:30:00-06:00")
- Timezone: IANA identifier (e.g., "America/Chicago")
- Recurrence: RRULE format (e.g., "RRULE:FREQ=WEEKLY;COUNT=10")

**Common Patterns**:
1. Single Event:
   - Collect title, time, attendees
   - Check for conflicts
   - Create and confirm

2. Recurring Event:
   - Validate recurrence pattern
   - Check series conflicts
   - Create with RRULE

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

IMPORTANT: Before any Drive operation:
1. Verify account access with list_workspace_accounts
2. Confirm account if multiple exist
3. Check Drive permissions

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

**Permission Types**:
- User: Share with specific email
- Group: Share with Google Group
- Domain: Share with entire domain
- Anyone: Public sharing

**Roles**:
- owner: Full ownership rights
- organizer: Organizational rights
- fileOrganizer: File organization rights
- writer: Edit access
- commenter: Comment access
- reader: View access

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

IMPORTANT: Before any Label operation:
1. Verify account access with list_workspace_accounts
2. Confirm Gmail account if multiple exist
3. Check label management permissions

**Label Features**:
- Nested labels: Use "/" (e.g., "Work/Projects")
- Custom colors: Hex codes (e.g., "#000000")
- Visibility options: Show/hide in lists

**Limitations**:
- Cannot create/modify system labels (INBOX, SENT, SPAM)
- Label names must be unique

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
