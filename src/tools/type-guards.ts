import {
  BaseToolArguments,
  CalendarEventParams,
  SendEmailArgs,
  ManageLabelParams,
  ManageLabelAssignmentParams,
  ManageLabelFilterParams,
  ManageDraftParams,
  DraftAction,
  DriveFileListArgs,
  DriveSearchArgs,
  DriveUploadArgs,
  DriveDownloadArgs,
  DriveFolderArgs,
  DrivePermissionArgs,
  DriveDeleteArgs
} from './types.js';

// Base Tool Arguments
export function isBaseToolArguments(args: Record<string, unknown>): args is BaseToolArguments {
  return typeof args.email === 'string';
}

export function assertBaseToolArguments(args: Record<string, unknown>): asserts args is BaseToolArguments {
  if (!isBaseToolArguments(args)) {
    throw new Error('Missing required email parameter');
  }
}

// Calendar Type Guards
export function isCalendarEventParams(args: Record<string, unknown>): args is CalendarEventParams {
  return typeof args.email === 'string' &&
    (args.query === undefined || typeof args.query === 'string') &&
    (args.maxResults === undefined || typeof args.maxResults === 'number') &&
    (args.timeMin === undefined || typeof args.timeMin === 'string') &&
    (args.timeMax === undefined || typeof args.timeMax === 'string');
}

export function assertCalendarEventParams(args: Record<string, unknown>): asserts args is CalendarEventParams {
  if (!isCalendarEventParams(args)) {
    throw new Error('Invalid calendar event parameters');
  }
}

export function isEmailEventIdArgs(args: Record<string, unknown>): args is { email: string; eventId: string } {
  return typeof args.email === 'string' && typeof args.eventId === 'string';
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

// Drive Type Guards
export function isDriveFileListArgs(args: unknown): args is DriveFileListArgs {
  if (typeof args !== 'object' || args === null) return false;
  const params = args as Partial<DriveFileListArgs>;
  
  return typeof params.email === 'string' &&
    (params.options === undefined || (() => {
      const opts = params.options as any;
      return (opts.folderId === undefined || typeof opts.folderId === 'string') &&
        (opts.query === undefined || typeof opts.query === 'string') &&
        (opts.pageSize === undefined || typeof opts.pageSize === 'number') &&
        (opts.orderBy === undefined || (Array.isArray(opts.orderBy) && opts.orderBy.every((o: unknown) => typeof o === 'string'))) &&
        (opts.fields === undefined || (Array.isArray(opts.fields) && opts.fields.every((f: unknown) => typeof f === 'string')));
    })());
}

export function assertDriveFileListArgs(args: unknown): asserts args is DriveFileListArgs {
  if (!isDriveFileListArgs(args)) {
    throw new Error('Invalid file list parameters. Required: email');
  }
}

export function isDriveSearchArgs(args: unknown): args is DriveSearchArgs {
  if (typeof args !== 'object' || args === null) return false;
  const params = args as Partial<DriveSearchArgs>;
  
  return typeof params.email === 'string' &&
    typeof params.options === 'object' && params.options !== null &&
    (params.options.fullText === undefined || typeof params.options.fullText === 'string') &&
    (params.options.mimeType === undefined || typeof params.options.mimeType === 'string') &&
    (params.options.folderId === undefined || typeof params.options.folderId === 'string') &&
    (params.options.trashed === undefined || typeof params.options.trashed === 'boolean') &&
    (params.options.query === undefined || typeof params.options.query === 'string') &&
    (params.options.pageSize === undefined || typeof params.options.pageSize === 'number');
}

export function assertDriveSearchArgs(args: unknown): asserts args is DriveSearchArgs {
  if (!isDriveSearchArgs(args)) {
    throw new Error('Invalid search parameters. Required: email, options');
  }
}

export function isDriveUploadArgs(args: unknown): args is DriveUploadArgs {
  if (typeof args !== 'object' || args === null) return false;
  const params = args as Partial<DriveUploadArgs>;
  
  return typeof params.email === 'string' &&
    typeof params.options === 'object' && params.options !== null &&
    typeof params.options.name === 'string' &&
    typeof params.options.content === 'string' &&
    (params.options.mimeType === undefined || typeof params.options.mimeType === 'string') &&
    (params.options.parents === undefined || (Array.isArray(params.options.parents) && params.options.parents.every(p => typeof p === 'string')));
}

export function assertDriveUploadArgs(args: unknown): asserts args is DriveUploadArgs {
  if (!isDriveUploadArgs(args)) {
    throw new Error('Invalid upload parameters. Required: email, options.name, options.content');
  }
}

export function isDriveDownloadArgs(args: unknown): args is DriveDownloadArgs {
  if (typeof args !== 'object' || args === null) return false;
  const params = args as Partial<DriveDownloadArgs>;
  
  return typeof params.email === 'string' &&
    typeof params.fileId === 'string' &&
    (params.mimeType === undefined || typeof params.mimeType === 'string');
}

export function assertDriveDownloadArgs(args: unknown): asserts args is DriveDownloadArgs {
  if (!isDriveDownloadArgs(args)) {
    throw new Error('Invalid download parameters. Required: email, fileId');
  }
}

export function isDriveFolderArgs(args: unknown): args is DriveFolderArgs {
  if (typeof args !== 'object' || args === null) return false;
  const params = args as Partial<DriveFolderArgs>;
  
  return typeof params.email === 'string' &&
    typeof params.name === 'string' &&
    (params.parentId === undefined || typeof params.parentId === 'string');
}

export function assertDriveFolderArgs(args: unknown): asserts args is DriveFolderArgs {
  if (!isDriveFolderArgs(args)) {
    throw new Error('Invalid folder parameters. Required: email, name');
  }
}

export function isDrivePermissionArgs(args: unknown): args is DrivePermissionArgs {
  if (typeof args !== 'object' || args === null) return false;
  const params = args as Partial<DrivePermissionArgs>;
  
  return typeof params.email === 'string' &&
    typeof params.options === 'object' && params.options !== null &&
    typeof params.options.fileId === 'string' &&
    ['owner', 'organizer', 'fileOrganizer', 'writer', 'commenter', 'reader'].includes(params.options.role) &&
    ['user', 'group', 'domain', 'anyone'].includes(params.options.type) &&
    (params.options.emailAddress === undefined || typeof params.options.emailAddress === 'string') &&
    (params.options.domain === undefined || typeof params.options.domain === 'string') &&
    (params.options.allowFileDiscovery === undefined || typeof params.options.allowFileDiscovery === 'boolean');
}

export function assertDrivePermissionArgs(args: unknown): asserts args is DrivePermissionArgs {
  if (!isDrivePermissionArgs(args)) {
    throw new Error('Invalid permission parameters. Required: email, options.fileId, options.role, options.type');
  }
}

export function isDriveDeleteArgs(args: unknown): args is DriveDeleteArgs {
  if (typeof args !== 'object' || args === null) return false;
  const params = args as Partial<DriveDeleteArgs>;
  
  return typeof params.email === 'string' &&
    typeof params.fileId === 'string';
}

export function assertDriveDeleteArgs(args: unknown): asserts args is DriveDeleteArgs {
  if (!isDriveDeleteArgs(args)) {
    throw new Error('Invalid delete parameters. Required: email, fileId');
  }
}

// Label Management Type Guards
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

export function assertManageLabelParams(args: unknown): asserts args is ManageLabelParams {
  if (!isManageLabelParams(args)) {
    throw new Error('Invalid label management parameters. Required: email, action');
  }
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

export function assertManageLabelAssignmentParams(args: unknown): asserts args is ManageLabelAssignmentParams {
  if (!isManageLabelAssignmentParams(args)) {
    throw new Error('Invalid label assignment parameters. Required: email, action, messageId, labelIds');
  }
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

export function assertManageLabelFilterParams(args: unknown): asserts args is ManageLabelFilterParams {
  if (!isManageLabelFilterParams(args)) {
    throw new Error('Invalid label filter parameters. Required: email, action');
  }
}

// Draft Management Type Guards
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
