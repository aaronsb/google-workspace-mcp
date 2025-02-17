export class McpError extends Error {
  code: ErrorCode;
  details?: Record<string, any>;

  constructor(code: ErrorCode, message: string, details?: Record<string, any>) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.details = details;
  }
}

export enum ErrorCode {
  InternalError = 'INTERNAL_ERROR',
  InvalidRequest = 'INVALID_REQUEST',
  MethodNotFound = 'METHOD_NOT_FOUND',
  InvalidParams = 'INVALID_PARAMS',
  AuthenticationRequired = 'AUTHENTICATION_REQUIRED',
  AuthenticationFailed = 'AUTHENTICATION_FAILED',
  PermissionDenied = 'PERMISSION_DENIED',
  ResourceNotFound = 'RESOURCE_NOT_FOUND',
  ServiceUnavailable = 'SERVICE_UNAVAILABLE'
}

export interface McpRequest {
  id: string;
  method: string;
  params: Record<string, any>;
}

export interface McpResponse {
  id: string;
  result?: any;
  error?: McpError;
}

export interface McpServerConfig {
  name: string;
  version: string;
  capabilities?: {
    resources?: Record<string, any>;
    tools?: Record<string, any>;
  };
}
