# Gmail Advanced Features Implementation

## Overview
Adding advanced Gmail features including user settings retrieval and enhanced search capabilities.

## Required Scopes
- [x] Add to scopes.ts:
  - https://www.googleapis.com/auth/gmail.settings.basic
  - https://www.googleapis.com/auth/gmail.settings.sharing

## New Tools

### get_workspace_gmail_settings
- [x] Implement new tool to collect:
  - Profile data:
    - Email address
    - Total messages count
    - Total threads count
    - History ID
  - Settings:
    - Auto-forwarding configuration
    - IMAP settings
    - Language preferences
    - POP settings
    - Vacation responder status
- [x] Format response for human readability
- [x] Add error handling for each API call
- [x] Add tool definition to index.ts
- [x] Add documentation with example responses

### search_workspace_emails (replacing list_workspace_emails)
- [x] Implement advanced search with filters:
  - Unread status (is:unread)
  - Sender (from:someone@example.com)
  - Date range (after:2024/01/01 before:2024/01/31)
  - Attachment presence (has:attachment)
- [x] Update existing tool definition with new parameters
- [x] Add new parameter types to types.ts
- [x] Update documentation with search examples
- [x] Add migration guide for users of list_workspace_emails

## Testing
- [x] Test new scopes authentication flow
- [x] Test settings retrieval:
  - Profile data
  - Each settings endpoint
  - Error scenarios
- [x] Test search functionality:
  - Individual filters
  - Combined filters
  - Edge cases
  - Error handling
