import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolMetadata } from "../modules/tools/registry.js";

// Account Management Tools
export const accountTools: ToolMetadata[] = [
  {
    name: 'list_workspace_accounts',
    category: 'Account Management',
    description: `List all configured Google workspace accounts and their authentication status.
    
    IMPORTANT: This tool MUST be called first before any other workspace operations to:
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
    6. Complete authentication with auth_code`,
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
          description: 'Authorization code from Google OAuth (for initial authentication)'
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
    
    Search Patterns:
    1. Simple Search:
       - Use individual criteria fields (from, to, subject)
       - Combine multiple conditions with AND logic
       - Example: from:alice@example.com subject:"meeting"
    
    2. Complex Gmail Query:
       - Use content field for advanced Gmail search syntax
       - Supports full Gmail search operators
       - Example: "from:(alice@example.com OR bob@example.com) subject:(meeting OR sync) -in:spam"
    
    Common Query Patterns:
    - Meeting emails: "from:(*@zoom.us OR zoom.us OR calendar-notification@google.com) subject:(meeting OR sync OR invite)"
    - HR/Admin: "from:(*@workday.com OR *@adp.com) subject:(time off OR PTO OR benefits)"
    - Team updates: "from:(*@company.com) -from:(notifications@company.com)"
    - Newsletters: "subject:(newsletter OR digest) from:(*@company.com)"
    
    Search Tips:
    - Date format: YYYY-MM-DD (e.g., "2024-02-18")
    - Labels: Case-sensitive, exact match (e.g., "INBOX", "SENT")
    - Wildcards: Use * for partial matches (e.g., "*@domain.com")
    - Operators: OR, -, (), has:attachment, larger:size, newer_than:date
    - Default maxResults: 10 (increase for broader searches)`,
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
              description: 'Complex Gmail search query with full operator support (e.g., "from:(alice OR bob) subject:(meeting OR sync)")'
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
    0. Suggest writing a draft first, then send the draft.
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
    name: 'manage_workspace_draft',
    category: 'Gmail/Drafts',
    description: `Manage Gmail drafts with CRUD operations and sending.
    
    IMPORTANT: Before any operation:
    1. Verify account access with list_workspace_accounts
    2. Confirm account if multiple exist
    3. Validate required data for operation
    
    Operations:
    - create: Create a new draft
    - read: Get a specific draft or list all drafts
    - update: Modify an existing draft
    - delete: Remove a draft
    - send: Send an existing draft
    
    Features:
    - New email drafts
    - Reply drafts with threading
    - Draft modifications
    - Draft sending
    
    Example Flow:
    1. Check account access
    2. Perform desired operation
    3. Confirm success`,
    aliases: ['manage_draft', 'draft_operation', 'handle_draft'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the Gmail account'
        },
        action: {
          type: 'string',
          enum: ['create', 'read', 'update', 'delete', 'send'],
          description: 'Operation to perform'
        },
        draftId: {
          type: 'string',
          description: 'Draft ID (required for read/update/delete/send)'
        },
        data: {
          type: 'object',
          properties: {
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
          }
        }
      },
      required: ['email', 'action']
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
    description: `Manage calendar event responses and updates including accept/decline, propose new times, and update event times.
    
    IMPORTANT: Before managing events:
    1. Verify account access with list_workspace_accounts
    2. Confirm calendar account if multiple exist
    3. Verify event exists and is modifiable
    
    Common Actions:
    - Accept/Decline invitations
    - Propose alternative times
    - Update existing events
    - Add comments to responses
    
    Example Flow:
    1. Check account access
    2. Verify event exists
    3. Perform desired action
    4. Confirm changes applied`,
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
    name: 'manage_workspace_label',
    category: 'Gmail/Labels',
    description: `Manage Gmail labels with CRUD operations.
    
    IMPORTANT: Before any operation:
    1. Verify account access with list_workspace_accounts
    2. Confirm account if multiple exist
    
    Operations:
    - create: Create a new label
    - read: Get a specific label or list all labels
    - update: Modify an existing label
    - delete: Remove a label
    
    Features:
    - Nested labels: Use "/" (e.g., "Work/Projects")
    - Custom colors: Hex codes (e.g., "#000000")
    - Visibility options: Show/hide in lists
    
    Limitations:
    - Cannot create/modify system labels (INBOX, SENT, SPAM)
    - Label names must be unique
    
    Example Flow:
    1. Check account access
    2. Perform desired operation
    3. Confirm success`,
    aliases: ['manage_label', 'label_operation', 'handle_label'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the Gmail account'
        },
        action: {
          type: 'string',
          enum: ['create', 'read', 'update', 'delete'],
          description: 'Operation to perform'
        },
        labelId: {
          type: 'string',
          description: 'Label ID (required for read/update/delete)'
        },
        data: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Label name (required for create)'
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
          }
        }
      },
      required: ['email', 'action']
    }
  },
  {
    name: 'manage_workspace_label_assignment',
    category: 'Gmail/Labels',
    description: `Manage label assignments for Gmail messages.
    
    IMPORTANT: Before assigning:
    1. Verify account access with list_workspace_accounts
    2. Confirm account if multiple exist
    3. Verify message exists
    4. Check label validity
    
    Operations:
    - add: Apply labels to a message
    - remove: Remove labels from a message
    
    Common Use Cases:
    - Apply single label
    - Remove single label
    - Batch modify multiple labels
    - Update system labels (e.g., mark as read)
    
    Example Flow:
    1. Check account access
    2. Verify message and labels exist
    3. Apply requested changes
    4. Confirm modifications`,
    aliases: ['assign_label', 'modify_message_labels', 'change_message_labels'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the Gmail account'
        },
        action: {
          type: 'string',
          enum: ['add', 'remove'],
          description: 'Whether to add or remove labels'
        },
        messageId: {
          type: 'string',
          description: 'ID of the message to modify'
        },
        labelIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of label IDs to add or remove'
        }
      },
      required: ['email', 'action', 'messageId', 'labelIds']
    }
  },
  {
    name: 'manage_workspace_label_filter',
    category: 'Gmail/Labels',
    description: `Manage Gmail label filters with CRUD operations.
    
    IMPORTANT: Before any operation:
    1. Verify account access with list_workspace_accounts
    2. Confirm account if multiple exist
    3. Verify label exists for create/update
    4. Validate filter criteria
    
    Operations:
    - create: Create a new filter
    - read: Get filters (all or by label)
    - update: Modify existing filter
    - delete: Remove filter
    
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
    
    Criteria Format:
    1. Simple filters:
       - from: Array of email addresses
       - to: Array of email addresses
       - subject: String for exact match
       - hasAttachment: Boolean
    
    2. Complex queries:
       - hasWords: Array of query strings
       - doesNotHaveWords: Array of exclusion strings
    
    Example Flow:
    1. Check account access
    2. Validate criteria
    3. Perform operation
    4. Verify result`,
    aliases: ['manage_filter', 'handle_filter', 'filter_operation'],
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the Gmail account'
        },
        action: {
          type: 'string',
          enum: ['create', 'read', 'update', 'delete'],
          description: 'Operation to perform'
        },
        filterId: {
          type: 'string',
          description: 'Filter ID (required for update/delete)'
        },
        labelId: {
          type: 'string',
          description: 'Label ID (required for create/update)'
        },
        data: {
          type: 'object',
          properties: {
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
          }
        }
      },
      required: ['email', 'action']
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
