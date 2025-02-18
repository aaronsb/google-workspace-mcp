import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolMetadata } from "../modules/tools/registry.js";

// Account Management Tools
export const accountTools: ToolMetadata[] = [
  {
    name: 'list_workspace_accounts',
    category: 'Account Management',
    description: 'List all configured Google workspace accounts and their authentication status',
    aliases: ['list_accounts', 'get_accounts', 'show_accounts'],
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'authenticate_workspace_account',
    category: 'Account Management',
    description: 'Add and authenticate a Google account for API access. IMPORTANT: When authenticating, always use the exact auth_url from the API response to ensure all OAuth parameters are preserved correctly. REQUIRED: When you get the auth_url, you must share it with the user by providing it in a response. The user will then click it to visit the URL and authorize the app. After authorization, the user will share that response with you. The auth_code will be a long string starting with "4/" followed by alphanumeric characters. Common errors include: expired auth_code (must be used quickly), invalid auth_code format, or missing required scopes. The response will include the account status and configured scopes.',
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
    description: 'Search emails in a Gmail account with advanced filtering capabilities. Date formats should be YYYY-MM-DD (e.g., "2024-02-18"). Label names are case-sensitive and should match Gmail exactly (e.g., "INBOX", "SENT", "IMPORTANT" for system labels). For pagination, use maxResults to limit initial results and handle the nextPageToken in the response if more results exist.',
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
    description: 'Send an email from a Gmail account',
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
    description: 'Get Gmail settings and profile information for a workspace account',
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
    description: 'Create a new email draft, with support for both new emails and replies',
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
    description: 'Get a list of email drafts',
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
    description: 'Get calendar events with optional filtering',
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
    description: 'Create a new calendar event. Times must be in ISO-8601 format (e.g., "2024-02-18T15:30:00-06:00"). Timezone should be an IANA timezone identifier (e.g., "America/Chicago"). For recurring events, use standard RRULE format (e.g., "RRULE:FREQ=WEEKLY;COUNT=10" for weekly for 10 occurrences). The response will include the created event ID and any scheduling conflicts with attendees.',
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
    description: 'List all labels in a Gmail account',
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
    description: 'Create a new label in a Gmail account. Note: System labels (e.g., INBOX, SENT, SPAM) cannot be created or modified. Color values should be hex codes (e.g., textColor: "#000000", backgroundColor: "#FFFFFF"). Nested labels can be created using "/" in the name (e.g., "Work/Projects"). The response will include the created label ID and full label details.',
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
    description: 'Update an existing label in a Gmail account',
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
    description: 'Add or remove labels from a Gmail message',
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
  }
];

// Export all tools combined
export const allTools: ToolMetadata[] = [
  ...accountTools,
  ...gmailTools,
  ...calendarTools,
  ...labelTools
];
