import {
  BaseToolArguments,
  CalendarEventParams,
  SendEmailArgs,
  ManageLabelParams,
  ManageLabelAssignmentParams,
  ManageLabelFilterParams,
  ManageDraftParams,
  DraftAction
} from './types.js';

export function isBaseToolArguments(args: Record<string, unknown>): args is BaseToolArguments {
  return typeof args.email === 'string';
}

export function isCalendarEventParams(args: Record<string, unknown>): args is CalendarEventParams {
  return typeof args.email === 'string' &&
    (args.query === undefined || typeof args.query === 'string') &&
    (args.maxResults === undefined || typeof args.maxResults === 'number') &&
    (args.timeMin === undefined || typeof args.timeMin === 'string') &&
    (args.timeMax === undefined || typeof args.timeMax === 'string');
}

export function isEmailEventIdArgs(args: Record<string, unknown>): args is { email: string; eventId: string } {
  return typeof args.email === 'string' && typeof args.eventId === 'string';
}

export function assertBaseToolArguments(args: Record<string, unknown>): asserts args is BaseToolArguments {
  if (!isBaseToolArguments(args)) {
    throw new Error('Missing required email parameter');
  }
}

export function assertCalendarEventParams(args: Record<string, unknown>): asserts args is CalendarEventParams {
  if (!isCalendarEventParams(args)) {
    throw new Error('Invalid calendar event parameters');
  }
}

export function assertEmailEventIdArgs(args: Record<string, unknown>): asserts args is { email: string; eventId: string } {
  if (!isEmailEventIdArgs(args)) {
    throw new Error('Missing required email or eventId parameter');
  }
}

// Gmail Type Guards
export function isSendEmailArgs(args: Record<string, unknown>): args is SendEmailArgs {
  return typeof args.email === 'string' &&
    Array.isArray(args.to) &&
    args.to.every(to => typeof to === 'string') &&
    typeof args.subject === 'string' &&
    typeof args.body === 'string' &&
    (args.cc === undefined || (Array.isArray(args.cc) && args.cc.every(cc => typeof cc === 'string'))) &&
    (args.bcc === undefined || (Array.isArray(args.bcc) && args.bcc.every(bcc => typeof bcc === 'string')));
}

export function assertSendEmailArgs(args: Record<string, unknown>): asserts args is SendEmailArgs {
  if (!isSendEmailArgs(args)) {
    throw new Error('Invalid email parameters. Required: email, to, subject, body');
  }
}

// Consolidated Draft Management Type Guards
export function isManageDraftParams(args: unknown): args is ManageDraftParams {
  if (typeof args !== 'object' || args === null) return false;
  const params = args as Partial<ManageDraftParams>;
  
  return typeof params.email === 'string' &&
    typeof params.action === 'string' &&
    ['create', 'read', 'update', 'delete', 'send'].includes(params.action) &&
    (params.draftId === undefined || typeof params.draftId === 'string') &&
    (params.data === undefined || (() => {
      if (typeof params.data !== 'object' || params.data === null) return false;
      const data = params.data as {
        to?: string[];
        subject?: string;
        body?: string;
        cc?: string[];
        bcc?: string[];
        replyToMessageId?: string;
        threadId?: string;
        references?: string[];
        inReplyTo?: string;
      };
      return (data.to === undefined || (Array.isArray(data.to) && data.to.every(to => typeof to === 'string'))) &&
        (data.subject === undefined || typeof data.subject === 'string') &&
        (data.body === undefined || typeof data.body === 'string') &&
        (data.cc === undefined || (Array.isArray(data.cc) && data.cc.every(cc => typeof cc === 'string'))) &&
        (data.bcc === undefined || (Array.isArray(data.bcc) && data.bcc.every(bcc => typeof bcc === 'string'))) &&
        (data.replyToMessageId === undefined || typeof data.replyToMessageId === 'string') &&
        (data.threadId === undefined || typeof data.threadId === 'string') &&
        (data.references === undefined || (Array.isArray(data.references) && data.references.every(ref => typeof ref === 'string'))) &&
        (data.inReplyTo === undefined || typeof data.inReplyTo === 'string');
    })());
}

export function assertManageDraftParams(args: unknown): asserts args is ManageDraftParams {
  if (!isManageDraftParams(args)) {
    throw new Error('Invalid draft management parameters. Required: email, action');
  }
}

// Consolidated Label Management Type Guards
export function isManageLabelParams(args: unknown): args is ManageLabelParams {
  if (typeof args !== 'object' || args === null) return false;
  const params = args as Partial<ManageLabelParams>;
  
  return typeof params.email === 'string' &&
    typeof params.action === 'string' &&
    ['create', 'read', 'update', 'delete'].includes(params.action) &&
    (params.labelId === undefined || typeof params.labelId === 'string') &&
    (params.data === undefined || (() => {
      if (typeof params.data !== 'object' || params.data === null) return false;
      const data = params.data as {
        name?: string;
        messageListVisibility?: string;
        labelListVisibility?: string;
      };
      return (data.name === undefined || typeof data.name === 'string') &&
        (data.messageListVisibility === undefined || ['show', 'hide'].includes(data.messageListVisibility)) &&
        (data.labelListVisibility === undefined || ['labelShow', 'labelHide', 'labelShowIfUnread'].includes(data.labelListVisibility));
    })());
}

export function isManageLabelAssignmentParams(args: unknown): args is ManageLabelAssignmentParams {
  if (typeof args !== 'object' || args === null) return false;
  const params = args as Partial<ManageLabelAssignmentParams>;
  
  return typeof params.email === 'string' &&
    typeof params.action === 'string' &&
    ['add', 'remove'].includes(params.action) &&
    typeof params.messageId === 'string' &&
    Array.isArray(params.labelIds) &&
    params.labelIds.every(id => typeof id === 'string');
}

export function isManageLabelFilterParams(args: unknown): args is ManageLabelFilterParams {
  if (typeof args !== 'object' || args === null) return false;
  const params = args as Partial<ManageLabelFilterParams>;
  
  return typeof params.email === 'string' &&
    typeof params.action === 'string' &&
    ['create', 'read', 'update', 'delete'].includes(params.action) &&
    (params.filterId === undefined || typeof params.filterId === 'string') &&
    (params.labelId === undefined || typeof params.labelId === 'string') &&
    (params.data === undefined || (() => {
      if (typeof params.data !== 'object' || params.data === null) return false;
      const data = params.data as {
        criteria?: { [key: string]: unknown };
        actions?: { addLabel: boolean; markImportant?: boolean; markRead?: boolean; archive?: boolean };
      };
      return (data.criteria === undefined || (typeof data.criteria === 'object' && data.criteria !== null)) &&
        (data.actions === undefined || (
          typeof data.actions === 'object' &&
          data.actions !== null &&
          typeof data.actions.addLabel === 'boolean'
        ));
    })());
}

export function assertManageLabelParams(args: unknown): asserts args is ManageLabelParams {
  if (!isManageLabelParams(args)) {
    throw new Error('Invalid label management parameters. Required: email, action');
  }
}

export function assertManageLabelAssignmentParams(args: unknown): asserts args is ManageLabelAssignmentParams {
  if (!isManageLabelAssignmentParams(args)) {
    throw new Error('Invalid label assignment parameters. Required: email, action, messageId, labelIds');
  }
}

export function assertManageLabelFilterParams(args: unknown): asserts args is ManageLabelFilterParams {
  if (!isManageLabelFilterParams(args)) {
    throw new Error('Invalid label filter parameters. Required: email, action');
  }
}
