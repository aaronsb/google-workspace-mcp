import {
  BaseToolArguments,
  CalendarEventParams,
  SendEmailArgs,
  CreateDraftArgs,
  SendDraftArgs,
  ManageLabelParams,
  ManageLabelAssignmentParams,
  ManageLabelFilterParams
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

export function isCreateDraftArgs(args: Record<string, unknown>): args is CreateDraftArgs {
  return isSendEmailArgs(args) &&
    (args.replyToMessageId === undefined || typeof args.replyToMessageId === 'string') &&
    (args.threadId === undefined || typeof args.threadId === 'string') &&
    (args.references === undefined || (Array.isArray(args.references) && args.references.every(ref => typeof ref === 'string'))) &&
    (args.inReplyTo === undefined || typeof args.inReplyTo === 'string');
}

export function isSendDraftArgs(args: Record<string, unknown>): args is SendDraftArgs {
  return typeof args.email === 'string' && typeof args.draftId === 'string';
}

export function assertSendEmailArgs(args: Record<string, unknown>): asserts args is SendEmailArgs {
  if (!isSendEmailArgs(args)) {
    throw new Error('Invalid email parameters. Required: email, to, subject, body');
  }
}

export function assertCreateDraftArgs(args: Record<string, unknown>): asserts args is CreateDraftArgs {
  if (!isCreateDraftArgs(args)) {
    throw new Error('Invalid draft parameters. Required: email, to, subject, body');
  }
}

export function assertSendDraftArgs(args: Record<string, unknown>): asserts args is SendDraftArgs {
  if (!isSendDraftArgs(args)) {
    throw new Error('Missing required email or draftId parameter');
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
