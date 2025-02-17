declare module '@modelcontextprotocol/sdk' {
  export class McpError extends Error {
    constructor(code: ErrorCode, message: string, details?: Record<string, any>);
  }

  export enum ErrorCode {
    InternalError = 'INTERNAL_ERROR',
    InvalidRequest = 'INVALID_REQUEST',
    MethodNotFound = 'METHOD_NOT_FOUND',
    InvalidParams = 'INVALID_PARAMS'
  }
}
