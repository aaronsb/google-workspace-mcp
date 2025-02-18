export class McpError extends Error {
  code: string;
  details?: Record<string, any>;

  constructor(code: string, message: string, details?: Record<string, any>) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = 'McpError';
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
  ServiceUnavailable = 'SERVICE_UNAVAILABLE',
  ParseError = 'PARSE_ERROR'
}
