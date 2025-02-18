import { Tool } from "@modelcontextprotocol/sdk/types.js";

// Account Management Tools
export const accountTools: Tool[] = [
  {
    name: 'list_workspace_accounts',
    description: 'List all configured Google workspace accounts and their authentication status',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'authenticate_workspace_account',
    description: 'Add and authenticate a Google account for API access. IMPORTANT: When authenticating, always use the exact auth_url from the API response to ensure all OAuth parameters are preserved correctly. REQUIRED: When you get the auth_url, you must share it with the user by providing it in a response. The user will then click it to visit the URL and authorize the app. After authorization, the user will share that response with you.',
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
    description: 'Remove a Google account and delete its associated authentication tokens',
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
export const gmailTools: Tool[] = [
  {
    name: 'search_workspace_emails',
    description: 'Search emails in a Gmail account with advanced filtering capabilities',
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
              description: 'Search emails after this date (YYYY-MM-DD)'
            },
            before: {
              type: 'string',
              description: 'Search emails before this date (YYYY-MM-DD)'
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
    description: 'Send an email from a Gmail account',
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
    description: 'Get Gmail settings and profile information for a workspace account',
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
    description: 'Create a new email draft, with support for both new emails and replies',
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
    description: 'Get a list of email drafts',
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
    description: 'Send an existing draft',
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
export const calendarTools: Tool[] = [
  {
    name: 'list_workspace_calendar_events',
    description: 'Get calendar events with optional filtering',
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
    description: 'Get a single calendar event by ID',
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
    description: 'Manage calendar event responses and updates including accept/decline, propose new times, and update event times',
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
    description: 'Create a new calendar event',
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
              description: 'Event start time (ISO date string)'
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
    description: 'Delete a calendar event',
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
export const labelTools: Tool[] = [
  {
    name: 'get_workspace_labels',
    description: 'List all labels in a Gmail account',
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
    description: 'Create a new label in a Gmail account',
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
              description: 'Text color in hex format'
            },
            backgroundColor: {
              type: 'string',
              description: 'Background color in hex format'
            }
          }
        }
      },
      required: ['email', 'name']
    }
  },
  {
    name: 'update_workspace_label',
    description: 'Update an existing label in a Gmail account',
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
    description: 'Delete a label from a Gmail account',
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
    description: 'Add or remove labels from a Gmail message',
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
export const allTools: Tool[] = [
  ...accountTools,
  ...gmailTools,
  ...calendarTools,
  ...labelTools
];
