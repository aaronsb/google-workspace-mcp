import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { ApiRequestParams, GoogleApiError } from '../types.js';

interface ServiceVersionMap {
  [key: string]: string;
}

export class GoogleApiRequest {
  private readonly serviceVersions: ServiceVersionMap = {
    gmail: 'v1',
    drive: 'v3',
    sheets: 'v4',
    calendar: 'v3'
  };

  constructor(private authClient: OAuth2Client) {}

  async makeRequest({
    endpoint,
    method,
    params = {},
    token
  }: ApiRequestParams): Promise<any> {
    try {
      // Set up authentication
      this.authClient.setCredentials({
        access_token: token
      });

      // Parse the endpoint to get service and method
      const [service, ...methodParts] = endpoint.split('.');
      const methodName = methodParts.join('.');

      // Get the Google API service
      const googleService = await this.getGoogleService(service);

      // Navigate to the method in the service
      const apiMethod = this.getApiMethod(googleService, methodName);

      // Make the API request with proper context binding
      const response = await apiMethod.call(googleService, {
        ...params,
        auth: this.authClient
      });

      return response.data;
    } catch (error: any) {
      throw this.handleApiError(error);
    }
  }

  private async getGoogleService(service: string): Promise<any> {
    const version = this.serviceVersions[service];
    if (!version) {
      throw new GoogleApiError(
        `Service "${service}" is not supported`,
        'SERVICE_NOT_SUPPORTED',
        `Supported services are: ${Object.keys(this.serviceVersions).join(', ')}`
      );
    }

    const serviceConstructor = (google as any)[service];
    if (!serviceConstructor) {
      throw new GoogleApiError(
        `Failed to initialize ${service} service`,
        'SERVICE_INIT_FAILED',
        'Please check the service name and try again'
      );
    }

    return serviceConstructor({ version, auth: this.authClient });
  }

  private getApiMethod(service: any, methodPath: string): Function {
    const method = methodPath.split('.').reduce((obj: any, part) => obj?.[part], service);

    if (typeof method !== 'function') {
      throw new GoogleApiError(
        `Method "${methodPath}" not found`,
        'METHOD_NOT_FOUND',
        'Please check the method name and try again'
      );
    }

    return method;
  }

  private handleApiError(error: any): never {
    if (error instanceof GoogleApiError) {
      throw error;
    }

    // Handle Google API specific errors
    if (error.response) {
      const { status, data } = error.response;
      const errorInfo = this.getErrorInfo(status, data);
      throw new GoogleApiError(
        errorInfo.message,
        errorInfo.code,
        errorInfo.resolution
      );
    }

    // Handle network or other errors
    throw new GoogleApiError(
      error.message || 'Unknown error occurred',
      'API_REQUEST_ERROR',
      'Check your network connection and try again'
    );
  }

  private getErrorInfo(status: number, data: any): { message: string; code: string; resolution: string } {
    const errorMap: Record<number, { code: string; resolution: string }> = {
      400: {
        code: 'BAD_REQUEST',
        resolution: 'Check the request parameters and try again'
      },
      401: {
        code: 'UNAUTHORIZED',
        resolution: 'Token may be expired. Try refreshing the token'
      },
      403: {
        code: 'FORBIDDEN',
        resolution: 'Insufficient permissions. Check required scopes'
      },
      404: {
        code: 'NOT_FOUND',
        resolution: 'Resource not found. Verify the endpoint and parameters'
      },
      429: {
        code: 'RATE_LIMIT',
        resolution: 'Rate limit exceeded. Try again later'
      },
      500: {
        code: 'SERVER_ERROR',
        resolution: 'Internal server error. Please try again later'
      },
      503: {
        code: 'SERVICE_UNAVAILABLE',
        resolution: 'Service is temporarily unavailable. Please try again later'
      }
    };

    const errorInfo = errorMap[status] || {
      code: `API_ERROR_${status}`,
      resolution: 'Check the API documentation for more details'
    };

    return {
      message: data.error?.message || 'API request failed',
      code: errorInfo.code,
      resolution: errorInfo.resolution
    };
  }
}
