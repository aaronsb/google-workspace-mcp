import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { getAccountManager } from '../modules/accounts/index.js';
import { getDriveService } from '../modules/drive/index.js';
import { FileListOptions, FileSearchOptions, FileUploadOptions, PermissionOptions } from '../modules/drive/types.js';
import { McpToolResponse } from './types.js';

interface DriveFileListArgs {
  email: string;
  options?: FileListOptions;
}

interface DriveSearchArgs {
  email: string;
  options: FileSearchOptions;
}

interface DriveUploadArgs {
  email: string;
  options: FileUploadOptions;
}

interface DriveDownloadArgs {
  email: string;
  fileId: string;
  mimeType?: string;
}

interface DriveFolderArgs {
  email: string;
  name: string;
  parentId?: string;
}

interface DrivePermissionArgs {
  email: string;
  options: PermissionOptions;
}

interface DriveDeleteArgs {
  email: string;
  fileId: string;
}

export async function handleListDriveFiles(args: DriveFileListArgs): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const result = await getDriveService().listFiles(args.email, args.options || {});
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}

export async function handleSearchDriveFiles(args: DriveSearchArgs): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const result = await getDriveService().searchFiles(args.email, args.options);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}

export async function handleUploadDriveFile(args: DriveUploadArgs): Promise<McpToolResponse> {
  if (!args.options.name) {
    throw new McpError(ErrorCode.InvalidParams, 'File name is required');
  }
  if (!args.options.content) {
    throw new McpError(ErrorCode.InvalidParams, 'File content is required');
  }

  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const result = await getDriveService().uploadFile(args.email, args.options);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}

export async function handleDownloadDriveFile(args: DriveDownloadArgs): Promise<McpToolResponse> {
  if (!args.fileId) {
    throw new McpError(ErrorCode.InvalidParams, 'File ID is required');
  }

  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const result = await getDriveService().downloadFile(args.email, {
      fileId: args.fileId,
      mimeType: args.mimeType
    });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}

export async function handleCreateDriveFolder(args: DriveFolderArgs): Promise<McpToolResponse> {
  if (!args.name) {
    throw new McpError(ErrorCode.InvalidParams, 'Folder name is required');
  }

  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const result = await getDriveService().createFolder(args.email, args.name, args.parentId);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}

export async function handleUpdateDrivePermissions(args: DrivePermissionArgs): Promise<McpToolResponse> {
  if (!args.options.fileId) {
    throw new McpError(ErrorCode.InvalidParams, 'File ID is required');
  }
  if (!args.options.role) {
    throw new McpError(ErrorCode.InvalidParams, 'Permission role is required');
  }
  if (!args.options.type) {
    throw new McpError(ErrorCode.InvalidParams, 'Permission type is required');
  }

  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const result = await getDriveService().updatePermissions(args.email, args.options);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}

export async function handleDeleteDriveFile(args: DriveDeleteArgs): Promise<McpToolResponse> {
  if (!args.fileId) {
    throw new McpError(ErrorCode.InvalidParams, 'File ID is required');
  }

  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const result = await getDriveService().deleteFile(args.email, args.fileId);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}
