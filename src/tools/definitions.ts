import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolMetadata } from "../modules/tools/registry.js";

// Account Management Tools
export const accountTools: ToolMetadata[] = [
  {
    name: 'list_workspace_accounts',
    category: 'Account Management',
    description: `List all configured Google workspace accounts and their authentication status.
    
    IMPORTANT: This tool MUST be called first before any Gmail/Calendar operations to:
    1. Check for existing authenticated accounts
    2. Determine which account to use if multiple exist
    3. Verify required API scopes are authorized
    
    Common Response Patterns:
    - Valid account exists → Proceed with requested operation
    - Multiple accounts exist → Ask user which to use
    - Token expired → Proceed normally (auto-refresh occurs)
    - No accounts exist → Start authentication flow
    
    Example Usage:
    1. User asks to "check email"
    2. Call this tool first to validate account access
    3. If account valid, proceed to email operations
    4. If multiple accounts, ask user "Which account would you like to use?"
    5. Remember chosen account for subsequent operations`,
    aliases: ['list_accounts', 'get_accounts', 'show_accounts'],
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'authenticate_workspace_account',
    category: 'Account Management',
    description: `Add and authenticate a Google account for API access.
    
    IMPORTANT: Only use this tool if list_workspace_accounts shows:
    1. No existing accounts, OR
    2. When using the account it seems to lack necessary auth scopes.
    
    To prevent wasted time, DO NOT use this tool:
    - Without checking list_workspace_accounts first
    - When token is just expired (auto-refresh handles this)
    - To re-authenticate an already valid account
    
    Steps to complete authentication:
    1. You call with required email address
    2. You receive auth_url in response
    3. You share EXACT auth_url with user - in a clickable URL form! (Important!)
    4. User completes OAuth flow by clicking on the link you furnished them
    5. User provides auth_code back to you
    6. Complete authentication with auth_code
    
    Technical Details:
    - Auth code format: "4/" followed by alphanumeric characters
    - Common errors: expired code, invalid format, missing scopes
    - Response includes: account status and configured scopes
    
    Example Usage:
    1. list_workspace_accounts shows no accounts
    2. Ask user for email to authenticate
    3. Start auth flow with provided email
    4. Share auth URL with user
    5. Complete flow with returned auth code`,
    aliases: ['auth_account', 'add_account', 'connect_account'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the Google account to authenticate'
        },
        category: {
          type: 'string',
          description: 'Account category (e.g., work, personal)'
        },
        description: {
          type: 'string',
          description: 'Account description'
        },
        auth_code: {
          type: 'string',
          description: 'Authorization code from Google OAuth (only needed during initial authentication)'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'remove_workspace_account',
    category: 'Account Management',
    description: 'Remove a Google account and delete its associated authentication tokens',
    aliases: ['delete_account', 'disconnect_account', 'remove_account'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the Google account to remove'
        }
      },
      required: ['email']
    }
  }
];

// Gmail Tools
export const gmailTools: ToolMetadata[] = [
  {
    name: 'search_workspace_emails',
    category: 'Gmail/Messages',
    description: `Search emails in a Gmail account with advanced filtering capabilities.

    IMPORTANT: Before using this tool:
    1. Call list_workspace_accounts to verify account access
    2. If multiple accounts, confirm which account to use
    3. Check required scopes include Gmail read access
    
    Common Usage Patterns:
    - Default search: Use minimal filters for initial results
    - Refined search: Add filters based on user needs
    - Pagination: Handle nextPageToken for large result sets
    
    Search Tips:
    - Date format: YYYY-MM-DD (e.g., "2024-02-18")
    - Labels: Case-sensitive, exact match (e.g., "INBOX", "SENT")
    - Default maxResults: 10 (increase for broader searches)
    
    Example Flows:
    1. User asks "check my email":
       - First call list_workspace_accounts
       - Use default search with INBOX label
       - Show recent unread messages first
    
    2. User asks "find emails from person@example.com":
       - Verify account access first
       - Search with from filter
       - Include relevant labels`,
    aliases: ['search_emails', 'find_emails', 'query_emails'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the Gmail account'
        },
        search: {
          type: 'object',
          description: 'Search criteria for filtering emails',
          properties: {
            from: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'string' } }
              ],
              description: 'Search by sender email address(es)'
            },
            to: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'string' } }
              ],
              description: 'Search by recipient email address(es)'
            },
            subject: {
              type: 'string',
              description: 'Search in email subject lines'
            },
            content: {
              type: 'string',
              description: 'Search in email body text'
            },
            after: {
              type: 'string',
              description: 'Search emails after this date in YYYY-MM-DD format (e.g., "2024-01-01")'
            },
            before: {
              type: 'string',
              description: 'Search emails before this date in YYYY-MM-DD format (e.g., "2024-12-31")'
            },
            hasAttachment: {
              type: 'boolean',
              description: 'Filter emails with attachments'
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Include emails with these labels (e.g., INBOX, SENT, IMPORTANT)'
            },
            excludeLabels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Exclude emails with these labels'
            },
            includeSpam: {
              type: 'boolean',
              description: 'Include emails from spam/trash folders'
            },
            isUnread: {
              type: 'boolean',
              description: 'Filter by read/unread status'
            }
          }
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of emails to return (default: 10)'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'send_workspace_email',
    category: 'Gmail/Messages',
    description: `Send an email from a Gmail account.
    
    IMPORTANT: Before sending:
    1. Verify account access with list_workspace_accounts
    2. Confirm sending account if multiple exist
    3. Validate all recipient addresses
    4. Check content for completeness
    
    Common Patterns:
    - Gather all required info before sending
    - Confirm critical details with user
    - Handle errors gracefully
    
    Example Flow:
    1. User requests to send email
    2. Check account access
    3. Collect recipient, subject, body
    4. Validate all fields
    5. Send and confirm success`,
    aliases: ['send_email', 'send_mail', 'create_email'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address to send from'
        },
        to: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of recipient email addresses'
        },
        subject: {
          type: 'string',
          description: 'Email subject'
        },
        body: {
          type: 'string',
          description: 'Email body content'
        },
        cc: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of CC recipient email addresses'
        },
        bcc: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of BCC recipient email addresses'
        }
      },
      required: ['email', 'to', 'subject', 'body']
    }
  },
  {
    name: 'get_workspace_gmail_settings',
    category: 'Gmail/Settings',
    description: `Get Gmail settings and profile information for a workspace account.
    
    IMPORTANT: Always verify account access first with list_workspace_accounts.
    
    Common Uses:
    - Check account configuration
    - Verify email settings
    - Access profile information
    
    Response includes:
    - Language settings
    - Signature settings
    - Vacation responder status
    - Filters and forwarding
    - Other account preferences`,
    aliases: ['get_gmail_settings', 'gmail_settings', 'get_mail_settings'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the Gmail account'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'create_workspace_draft',
    category: 'Gmail/Drafts',
    description: `Create a new email draft, with support for both new emails and replies.
    
    IMPORTANT: Before creating drafts:
    1. Verify account access with list_workspace_accounts
    2. Confirm account choice if multiple exist
    3. Gather all required content
    
    Common Patterns:
    - New Email Draft:
      1. Collect recipient, subject, body
      2. Save as draft for user review
    
    - Reply Draft:
      1. Verify original message exists
      2. Include proper threading info
      3. Maintain conversation context
    
    Example Flow:
    1. User requests draft creation
    2. Check account access
    3. Collect email details
    4. Create draft
    5. Confirm draft saved successfully`,
    aliases: ['create_draft', 'new_draft', 'save_draft'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the Gmail account'
        },
        to: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of recipient email addresses'
        },
        subject: {
          type: 'string',
          description: 'Email subject'
        },
        body: {
          type: 'string',
          description: 'Email body content'
        },
        cc: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of CC recipient email addresses'
        },
        bcc: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of BCC recipient email addresses'
        },
        replyToMessageId: {
          type: 'string',
          description: 'Message ID to reply to (for creating reply drafts)'
        },
        threadId: {
          type: 'string',
          description: 'Thread ID for the email (optional for replies)'
        },
        references: {
          type: 'array',
          items: { type: 'string' },
          description: 'Reference message IDs for email threading'
        },
        inReplyTo: {
          type: 'string',
          description: 'Message ID being replied to (for email threading)'
        }
      },
      required: ['email', 'to', 'subject', 'body']
    }
  },
  {
    name: 'get_workspace_drafts',
    category: 'Gmail/Drafts',
    description: `Get a list of email drafts.
    
    IMPORTANT: Before listing drafts:
    1. Verify account access with list_workspace_accounts
    2. Confirm account if multiple exist
    
    Common Uses:
    - Show pending drafts
    - Find specific draft
    - Check draft status
    
    Response includes:
    - Draft IDs
    - Recipients
    - Subjects
    - Last modified time`,
    aliases: ['list_drafts', 'show_drafts', 'view_drafts'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the Gmail account'
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of drafts to return (default: 10)'
        },
        pageToken: {
          type: 'string',
          description: 'Page token for pagination'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'send_workspace_draft',
    category: 'Gmail/Drafts',
    description: 'Send an existing draft',
    aliases: ['send_draft', 'publish_draft'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the Gmail account'
        },
        draftId: {
          type: 'string',
          description: 'ID of the draft to send'
        }
      },
      required: ['email', 'draftId']
    }
  }
];

// Calendar Tools
export const calendarTools: ToolMetadata[] = [
  {
    name: 'list_workspace_calendar_events',
    category: 'Calendar/Events',
    description: `Get calendar events with optional filtering.
    
    IMPORTANT: Before listing events:
    1. Verify account access with list_workspace_accounts
    2. Confirm calendar account if multiple exist
    3. Check calendar access permissions
    
    Common Usage Patterns:
    - Default view: Current week's events
    - Specific range: Use timeMin/timeMax
    - Search: Use query for text search
    
    Example Flows:
    1. User asks "check my calendar":
       - Verify account access
       - Show current week by default
       - Include upcoming events
    
    2. User asks "find meetings about project":
       - Check account access
       - Search with relevant query
       - Focus on recent/upcoming events`,
    aliases: ['list_events', 'get_events', 'show_events'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the calendar owner'
        },
        query: {
          type: 'string',
          description: 'Optional text search within events'
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of events to return (default: 10)'
        },
        timeMin: {
          type: 'string',
          description: 'Start of time range to search (ISO date string)'
        },
        timeMax: {
          type: 'string',
          description: 'End of time range to search (ISO date string)'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'get_workspace_calendar_event',
    category: 'Calendar/Events',
    description: 'Get a single calendar event by ID',
    aliases: ['get_event', 'view_event', 'show_event'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the calendar owner'
        },
        eventId: {
          type: 'string',
          description: 'Unique identifier of the event to retrieve'
        }
      },
      required: ['email', 'eventId']
    }
  },
  {
    name: 'manage_workspace_calendar_event',
    category: 'Calendar/Events',
    description: 'Manage calendar event responses and updates including accept/decline, propose new times, and update event times',
    aliases: ['manage_event', 'update_event', 'respond_to_event'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the calendar owner'
        },
        eventId: {
          type: 'string',
          description: 'ID of the event to manage'
        },
        action: {
          type: 'string',
          enum: ['accept', 'decline', 'tentative', 'propose_new_time', 'update_time'],
          description: 'Action to perform on the event'
        },
        comment: {
          type: 'string',
          description: 'Optional comment to include with the response'
        },
        newTimes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              start: {
                type: 'object',
                properties: {
                  dateTime: {
                    type: 'string',
                    description: 'Start time (ISO date string)'
                  },
                  timeZone: {
                    type: 'string',
                    description: 'Timezone for start time'
                  }
                },
                required: ['dateTime']
              },
              end: {
                type: 'object',
                properties: {
                  dateTime: {
                    type: 'string',
                    description: 'End time (ISO date string)'
                  },
                  timeZone: {
                    type: 'string',
                    description: 'Timezone for end time'
                  }
                },
                required: ['dateTime']
              }
            },
            required: ['start', 'end']
          },
          description: 'New proposed times for the event'
        }
      },
      required: ['email', 'eventId', 'action']
    }
  },
  {
    name: 'create_workspace_calendar_event',
    category: 'Calendar/Events',
    description: `Create a new calendar event.
    
    IMPORTANT: Before creating events:
    1. Verify account access with list_workspace_accounts
    2. Confirm calendar account if multiple exist
    3. Validate all required details
    
    Required Formats:
    - Times: ISO-8601 (e.g., "2024-02-18T15:30:00-06:00")
    - Timezone: IANA identifier (e.g., "America/Chicago")
    - Recurrence: RRULE format (e.g., "RRULE:FREQ=WEEKLY;COUNT=10")
    
    Common Patterns:
    1. Single Event:
       - Collect title, time, attendees
       - Check for conflicts
       - Create and confirm
    
    2. Recurring Event:
       - Validate recurrence pattern
       - Check series conflicts
       - Create with RRULE
    
    Response includes:
    - Created event ID
    - Scheduling conflicts
    - Attendee responses`,
    aliases: ['create_event', 'new_event', 'schedule_event'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the calendar owner'
        },
        summary: {
          type: 'string',
          description: 'Event title'
        },
        description: {
          type: 'string',
          description: 'Optional event description'
        },
        start: {
          type: 'object',
          properties: {
            dateTime: {
              type: 'string',
              description: 'Event start time as ISO-8601 string (e.g., "2024-02-18T15:30:00-06:00")'
            },
            timeZone: {
              type: 'string',
              description: 'IANA timezone identifier (e.g., "America/Chicago", "Europe/London")'
            }
          },
          required: ['dateTime']
        },
        end: {
          type: 'object',
          properties: {
            dateTime: {
              type: 'string',
              description: 'Event end time (ISO date string)'
            },
            timeZone: {
              type: 'string',
              description: 'Timezone for end time'
            }
          },
          required: ['dateTime']
        },
        attendees: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              email: {
                type: 'string',
                description: 'Attendee email address'
              }
            },
            required: ['email']
          },
          description: 'Optional list of event attendees'
        },
        recurrence: {
          type: 'array',
          items: { type: 'string' },
          description: 'RRULE strings for recurring events (e.g., ["RRULE:FREQ=WEEKLY"])'
        }
      },
      required: ['email', 'summary', 'start', 'end']
    }
  },
  {
    name: 'delete_workspace_calendar_event',
    category: 'Calendar/Events',
    description: 'Delete a calendar event',
    aliases: ['delete_event', 'remove_event', 'cancel_event'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the calendar owner'
        },
        eventId: {
          type: 'string',
          description: 'ID of the event to delete'
        },
        sendUpdates: {
          type: 'string',
          enum: ['all', 'externalOnly', 'none'],
          description: 'Whether to send update notifications'
        }
      },
      required: ['email', 'eventId']
    }
  }
];

// Label Management Tools
export const labelTools: ToolMetadata[] = [
  {
    name: 'get_workspace_labels',
    category: 'Gmail/Labels',
    description: `List all labels in a Gmail account.
    
    IMPORTANT: Before listing labels:
    1. Verify account access with list_workspace_accounts
    2. Confirm account if multiple exist
    
    Response includes:
    - System labels (INBOX, SENT, etc.)
    - Custom labels
    - Nested label hierarchies
    - Label visibility settings
    - Label colors if set`,
    aliases: ['list_labels', 'show_labels', 'get_labels'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the Gmail account'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'create_workspace_label',
    category: 'Gmail/Labels',
    description: `Create a new label in a Gmail account.
    
    IMPORTANT: Before creating labels:
    1. Verify account access with list_workspace_accounts
    2. Confirm account if multiple exist
    3. Check if similar label exists
    
    Limitations:
    - Cannot create/modify system labels (INBOX, SENT, SPAM)
    - Label names must be unique
    
    Features:
    - Nested labels: Use "/" (e.g., "Work/Projects")
    - Custom colors: Hex codes (e.g., "#000000")
    - Visibility options: Show/hide in lists
    
    Example Flow:
    1. Check account access
    2. Verify label doesn't exist
    3. Create with desired settings
    4. Confirm creation success`,
    aliases: ['create_label', 'new_label', 'add_label', 'create_gmail_label'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the Gmail account'
        },
        name: {
          type: 'string',
          description: 'Name of the label'
        },
        messageListVisibility: {
          type: 'string',
          enum: ['show', 'hide'],
          description: 'Label visibility in message list'
        },
        labelListVisibility: {
          type: 'string',
          enum: ['labelShow', 'labelHide', 'labelShowIfUnread'],
          description: 'Label visibility in label list'
        },
        color: {
          type: 'object',
          properties: {
            textColor: {
              type: 'string',
              description: 'Text color in hex format (e.g., "#000000" for black)'
            },
            backgroundColor: {
              type: 'string',
              description: 'Background color in hex format (e.g., "#FFFFFF" for white)'
            }
          }
        }
      },
      required: ['email', 'name']
    }
  },
  {
    name: 'update_workspace_label',
    category: 'Gmail/Labels',
    description: `Update an existing label in a Gmail account.
    
    IMPORTANT: Before updating:
    1. Verify account access with list_workspace_accounts
    2. Confirm account if multiple exist
    3. Verify label exists and is modifiable
    
    Common Updates:
    - Rename label
    - Change colors
    - Adjust visibility
    - Modify hierarchy
    
    Limitations:
    - Cannot modify system labels
    - Cannot create duplicates
    - Must maintain unique names`,
    aliases: ['update_label', 'edit_label', 'modify_label'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the Gmail account'
        },
        labelId: {
          type: 'string',
          description: 'ID of the label to update'
        },
        name: {
          type: 'string',
          description: 'New name for the label'
        },
        messageListVisibility: {
          type: 'string',
          enum: ['show', 'hide'],
          description: 'Label visibility in message list'
        },
        labelListVisibility: {
          type: 'string',
          enum: ['labelShow', 'labelHide', 'labelShowIfUnread'],
          description: 'Label visibility in label list'
        },
        color: {
          type: 'object',
          properties: {
            textColor: {
              type: 'string',
              description: 'Text color in hex format'
            },
            backgroundColor: {
              type: 'string',
              description: 'Background color in hex format'
            }
          }
        }
      },
      required: ['email', 'labelId']
    }
  },
  {
    name: 'delete_workspace_label',
    category: 'Gmail/Labels',
    description: 'Delete a label from a Gmail account',
    aliases: ['delete_label', 'remove_label'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the Gmail account'
        },
        labelId: {
          type: 'string',
          description: 'ID of the label to delete'
        }
      },
      required: ['email', 'labelId']
    }
  },
  {
    name: 'modify_workspace_message_labels',
    category: 'Gmail/Labels',
    description: `Add or remove labels from a Gmail message.
    
    IMPORTANT: Before modifying:
    1. Verify account access with list_workspace_accounts
    2. Confirm account if multiple exist
    3. Verify message exists
    4. Check label validity
    
    Common Patterns:
    - Add single label
    - Remove single label
    - Batch modify multiple labels
    - Update system labels (e.g., mark as read)
    
    Example Flow:
    1. Check account access
    2. Verify message and labels exist
    3. Apply requested changes
    4. Confirm modifications`,
    aliases: ['modify_message_labels', 'update_message_labels', 'change_message_labels'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the Gmail account'
        },
        messageId: {
          type: 'string',
          description: 'ID of the message to modify'
        },
        addLabelIds: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: 'Array of label IDs to add to the message'
        },
        removeLabelIds: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: 'Array of label IDs to remove from the message'
        }
      },
      required: ['email', 'messageId']
    }
  },
  {
    name: 'create_workspace_label_filter',
    category: 'Gmail/Labels',
    description: `Create a new filter for a Gmail label.
    
    IMPORTANT: Before creating filters:
    1. Verify account access with list_workspace_accounts
    2. Confirm account if multiple exist
    3. Verify label exists
    4. Validate filter criteria
    
    Filter Capabilities:
    - Match sender(s) and recipient(s)
    - Search subject and content
    - Filter by attachments
    - Size-based filtering
    
    Actions Available:
    - Apply label automatically
    - Mark as important
    - Mark as read
    - Archive message
    
    Example Flow:
    1. Check account access
    2. Verify label exists
    3. Create filter with criteria
    4. Confirm filter creation`,
    aliases: ['create_filter', 'add_filter', 'new_label_filter'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the Gmail account'
        },
        labelId: {
          type: 'string',
          description: 'ID of the label to apply'
        },
        criteria: {
          type: 'object',
          properties: {
            from: {
              type: 'array',
              items: { type: 'string' },
              description: 'Match sender email addresses'
            },
            to: {
              type: 'array',
              items: { type: 'string' },
              description: 'Match recipient email addresses'
            },
            subject: {
              type: 'string',
              description: 'Match text in subject'
            },
            hasWords: {
              type: 'array',
              items: { type: 'string' },
              description: 'Match words in message body'
            },
            doesNotHaveWords: {
              type: 'array',
              items: { type: 'string' },
              description: 'Exclude messages with these words'
            },
            hasAttachment: {
              type: 'boolean',
              description: 'Match messages with attachments'
            },
            size: {
              type: 'object',
              properties: {
                operator: {
                  type: 'string',
                  enum: ['larger', 'smaller'],
                  description: 'Size comparison operator'
                },
                size: {
                  type: 'number',
                  description: 'Size in bytes'
                }
              }
            }
          }
        },
        actions: {
          type: 'object',
          properties: {
            addLabel: {
              type: 'boolean',
              description: 'Apply the label'
            },
            markImportant: {
              type: 'boolean',
              description: 'Mark as important'
            },
            markRead: {
              type: 'boolean',
              description: 'Mark as read'
            },
            archive: {
              type: 'boolean',
              description: 'Archive the message'
            }
          },
          required: ['addLabel']
        }
      },
      required: ['email', 'labelId', 'criteria', 'actions']
    }
  },
  {
    name: 'get_workspace_label_filters',
    category: 'Gmail/Labels',
    description: `Get filters for a Gmail label.
    
    IMPORTANT: Before listing filters:
    1. Verify account access with list_workspace_accounts
    2. Confirm account if multiple exist
    
    Response includes:
    - Filter IDs
    - Filter criteria
    - Associated actions
    - Label associations`,
    aliases: ['list_filters', 'show_filters', 'get_filters'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the Gmail account'
        },
        labelId: {
          type: 'string',
          description: 'Optional: get filters for specific label'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'update_workspace_label_filter',
    category: 'Gmail/Labels',
    description: `Update an existing Gmail label filter.
    
    IMPORTANT: Before updating:
    1. Verify account access with list_workspace_accounts
    2. Confirm account if multiple exist
    3. Verify filter exists
    
    Common Updates:
    - Modify criteria
    - Change actions
    - Adjust matching rules
    
    Example Flow:
    1. Check account access
    2. Verify filter exists
    3. Apply updates
    4. Confirm changes`,
    aliases: ['update_filter', 'edit_filter', 'modify_filter'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the Gmail account'
        },
        filterId: {
          type: 'string',
          description: 'ID of filter to update'
        },
        criteria: {
          type: 'object',
          properties: {
            from: {
              type: 'array',
              items: { type: 'string' },
              description: 'Match sender email addresses'
            },
            to: {
              type: 'array',
              items: { type: 'string' },
              description: 'Match recipient email addresses'
            },
            subject: {
              type: 'string',
              description: 'Match text in subject'
            },
            hasWords: {
              type: 'array',
              items: { type: 'string' },
              description: 'Match words in message body'
            },
            doesNotHaveWords: {
              type: 'array',
              items: { type: 'string' },
              description: 'Exclude messages with these words'
            },
            hasAttachment: {
              type: 'boolean',
              description: 'Match messages with attachments'
            },
            size: {
              type: 'object',
              properties: {
                operator: {
                  type: 'string',
                  enum: ['larger', 'smaller'],
                  description: 'Size comparison operator'
                },
                size: {
                  type: 'number',
                  description: 'Size in bytes'
                }
              }
            }
          }
        },
        actions: {
          type: 'object',
          properties: {
            addLabel: {
              type: 'boolean',
              description: 'Apply the label'
            },
            markImportant: {
              type: 'boolean',
              description: 'Mark as important'
            },
            markRead: {
              type: 'boolean',
              description: 'Mark as read'
            },
            archive: {
              type: 'boolean',
              description: 'Archive the message'
            }
          }
        }
      },
      required: ['email', 'filterId']
    }
  },
  {
    name: 'delete_workspace_label_filter',
    category: 'Gmail/Labels',
    description: `Delete a Gmail label filter.
    
    IMPORTANT: Before deleting:
    1. Verify account access with list_workspace_accounts
    2. Confirm account if multiple exist
    3. Verify filter exists
    4. Confirm deletion intent
    
    Note: This action cannot be undone.`,
    aliases: ['delete_filter', 'remove_filter'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the Gmail account'
        },
        filterId: {
          type: 'string',
          description: 'ID of filter to delete'
        }
      },
      required: ['email', 'filterId']
    }
  }
];

// Export all tools combined
export const allTools: ToolMetadata[] = [
  ...accountTools,
  ...gmailTools,
  ...calendarTools,
  ...labelTools
];
