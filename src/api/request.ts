import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { ApiRequestParams, GoogleApiError } from '../types.js';

export class GoogleApiRequest {
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

      if (!service || !methodName) {
        throw new GoogleApiError(
          'Invalid API endpoint format',
          'INVALID_ENDPOINT',
          'Endpoint should be in format "service.method" (e.g., "drive.files.list")'
        );
      }

      // Get the Google API service
      const googleService = (google as any)[service]({
        version: 'v3', // Default to v3, can be made configurable if needed
        auth: this.authClient
      });

      // Navigate to the method in the service
      const apiMethod = methodName.split('.').reduce((obj, part) => obj[part], googleService);

      if (typeof apiMethod !== 'function') {
        throw new GoogleApiError(
          'Invalid API method',
          'METHOD_NOT_FOUND',
          `Method ${methodName} not found in service ${service}`
        );
      }

      // Make the API request
      const response = await apiMethod({
        ...params,
        auth: this.authClient
      });

      return response.data;
    } catch (error: any) {
      if (error instanceof GoogleApiError) {
        throw error;
      }

      // Handle Google API specific errors
      if (error.response) {
        const { status, data } = error.response;
        let resolution: string | undefined;

        switch (status) {
          case 401:
            resolution = 'Token may be expired. Try refreshing the token.';
            break;
          case 403:
            resolution = 'Insufficient permissions. Check required scopes.';
            break;
          case 404:
            resolution = 'Resource not found. Verify the endpoint and parameters.';
            break;
          case 429:
            resolution = 'Rate limit exceeded. Try again later.';
            break;
          default:
            resolution = 'Check the API documentation for more details.';
        }

        throw new GoogleApiError(
          data.error?.message || 'API request failed',
          `API_ERROR_${status}`,
          resolution
        );
      }

      // Handle network or other errors
      throw new GoogleApiError(
        error.message || 'Unknown error occurred',
        'API_REQUEST_ERROR',
        'Check your network connection and try again'
      );
    }
  }
}
