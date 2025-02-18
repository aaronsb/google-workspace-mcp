import {
  BaseToolArguments,
  CalendarEventParams,
  SendEmailArgs,
  CreateDraftArgs,
  SendDraftArgs,
  CreateLabelArgs,
  UpdateLabelArgs,
  DeleteLabelArgs,
  ModifyLabelsArgs,
  CreateLabelFilterArgs,
  GetLabelFiltersArgs,
  UpdateLabelFilterArgs,
  DeleteLabelFilterArgs
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

export function isCreateLabelArgs(args: Record<string, unknown>): args is CreateLabelArgs {
  return typeof args.email === 'string' &&
    typeof args.name === 'string' &&
    (args.messageListVisibility === undefined || ['show', 'hide'].includes(args.messageListVisibility as string)) &&
    (args.labelListVisibility === undefined || ['labelShow', 'labelHide', 'labelShowIfUnread'].includes(args.labelListVisibility as string)) &&
    (args.color === undefined || (
      typeof args.color === 'object' &&
      args.color !== null &&
      typeof (args.color as { textColor: string }).textColor === 'string' &&
      typeof (args.color as { backgroundColor: string }).backgroundColor === 'string'
    ));
}

export function isUpdateLabelArgs(args: Record<string, unknown>): args is UpdateLabelArgs {
  return isCreateLabelArgs(args) && typeof args.labelId === 'string';
}

export function isDeleteLabelArgs(args: Record<string, unknown>): args is DeleteLabelArgs {
  return typeof args.email === 'string' && typeof args.labelId === 'string';
}

export function isModifyLabelsArgs(args: Record<string, unknown>): args is ModifyLabelsArgs {
  return typeof args.email === 'string' &&
    typeof args.messageId === 'string' &&
    (args.addLabelIds === undefined || (Array.isArray(args.addLabelIds) && args.addLabelIds.every(id => typeof id === 'string'))) &&
    (args.removeLabelIds === undefined || (Array.isArray(args.removeLabelIds) && args.removeLabelIds.every(id => typeof id === 'string')));
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

export function assertCreateLabelArgs(args: Record<string, unknown>): asserts args is CreateLabelArgs {
  if (!isCreateLabelArgs(args)) {
    throw new Error('Invalid label parameters. Required: email, name');
  }
}

export function assertUpdateLabelArgs(args: Record<string, unknown>): asserts args is UpdateLabelArgs {
  if (!isUpdateLabelArgs(args)) {
    throw new Error('Invalid label update parameters. Required: email, labelId, name');
  }
}

export function assertDeleteLabelArgs(args: Record<string, unknown>): asserts args is DeleteLabelArgs {
  if (!isDeleteLabelArgs(args)) {
    throw new Error('Missing required email or labelId parameter');
  }
}

export function assertModifyLabelsArgs(args: Record<string, unknown>): asserts args is ModifyLabelsArgs {
  if (!isModifyLabelsArgs(args)) {
    throw new Error('Invalid label modification parameters. Required: email, messageId');
  }
}

// Label Filter Type Guards
export function isCreateLabelFilterArgs(args: Record<string, unknown>): args is CreateLabelFilterArgs {
  return typeof args.email === 'string' &&
    typeof args.labelId === 'string' &&
    typeof args.criteria === 'object' &&
    args.criteria !== null &&
    typeof args.actions === 'object' &&
    args.actions !== null &&
    typeof (args.actions as { addLabel: boolean }).addLabel === 'boolean';
}

export function isGetLabelFiltersArgs(args: Record<string, unknown>): args is GetLabelFiltersArgs {
  return typeof args.email === 'string' &&
    (args.labelId === undefined || typeof args.labelId === 'string');
}

export function isUpdateLabelFilterArgs(args: Record<string, unknown>): args is UpdateLabelFilterArgs {
  return typeof args.email === 'string' &&
    typeof args.filterId === 'string' &&
    (args.criteria === undefined || (typeof args.criteria === 'object' && args.criteria !== null)) &&
    (args.actions === undefined || (typeof args.actions === 'object' && args.actions !== null));
}

export function isDeleteLabelFilterArgs(args: Record<string, unknown>): args is DeleteLabelFilterArgs {
  return typeof args.email === 'string' && typeof args.filterId === 'string';
}

export function assertCreateLabelFilterArgs(args: Record<string, unknown>): asserts args is CreateLabelFilterArgs {
  if (!isCreateLabelFilterArgs(args)) {
    throw new Error('Invalid filter parameters. Required: email, labelId, criteria, actions');
  }
}

export function assertGetLabelFiltersArgs(args: Record<string, unknown>): asserts args is GetLabelFiltersArgs {
  if (!isGetLabelFiltersArgs(args)) {
    throw new Error('Missing required email parameter');
  }
}

export function assertUpdateLabelFilterArgs(args: Record<string, unknown>): asserts args is UpdateLabelFilterArgs {
  if (!isUpdateLabelFilterArgs(args)) {
    throw new Error('Invalid filter update parameters. Required: email, filterId');
  }
}

export function assertDeleteLabelFilterArgs(args: Record<string, unknown>): asserts args is DeleteLabelFilterArgs {
  if (!isDeleteLabelFilterArgs(args)) {
    throw new Error('Missing required email or filterId parameter');
  }
}
