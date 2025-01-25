import { GoogleApiRequestParams, GoogleApiError } from '../../types.js';

interface ParameterConfig {
  required: string[];
  types: Record<string, string>;
}

export class ParameterValidator {
  // Registry of endpoint-specific parameter configurations
  private readonly parameterRegistry: Record<string, ParameterConfig> = {
    'gmail.users.messages.list': {
      required: ['userId'],
      types: {
        userId: 'string',
        maxResults: 'number',
        pageToken: 'string',
        q: 'string',
        labelIds: 'array'
      }
    },
    'gmail.users.messages.get': {
      required: ['userId', 'id'],
      types: {
        userId: 'string',
        id: 'string',
        format: 'string'
      }
    },
    'gmail.users.messages.send': {
      required: ['userId', 'message'],
      types: {
        userId: 'string',
        message: 'object'
      }
    },
    'drive.files.list': {
      required: [],
      types: {
        pageSize: 'number',
        pageToken: 'string',
        q: 'string',
        spaces: 'string',
        fields: 'string'
      }
    },
    'drive.files.get': {
      required: ['fileId'],
      types: {
        fileId: 'string',
        fields: 'string',
        acknowledgeAbuse: 'boolean'
      }
    }
  };

  async validate(params: GoogleApiRequestParams): Promise<void> {
    const { api_endpoint, params: methodParams = {} } = params;

    // Get parameter configuration for this endpoint
    const config = this.parameterRegistry[api_endpoint];
    if (!config) {
      // If no specific config exists, only validate the base required params
      this.validateBaseParams(params);
      return;
    }

    // Validate required parameters
    this.validateRequiredParams(api_endpoint, methodParams, config.required);

    // Validate parameter types
    this.validateParamTypes(api_endpoint, methodParams, config.types);
  }

  private validateBaseParams(params: GoogleApiRequestParams): void {
    const requiredBaseParams = ['email', 'api_endpoint', 'method', 'required_scopes'];
    const missingParams = requiredBaseParams.filter(param => !(param in params));

    if (missingParams.length > 0) {
      throw new GoogleApiError(
        'Missing required parameters',
        'MISSING_REQUIRED_PARAMS',
        `The following parameters are required: ${missingParams.join(', ')}`
      );
    }
  }

  private validateRequiredParams(
    endpoint: string,
    params: Record<string, any>,
    required: string[]
  ): void {
    const missingParams = required.filter(param => !(param in params));

    if (missingParams.length > 0) {
      throw new GoogleApiError(
        'Missing required parameters',
        'MISSING_REQUIRED_PARAMS',
        `The following parameters are required for ${endpoint}: ${missingParams.join(', ')}`
      );
    }
  }

  private validateParamTypes(
    endpoint: string,
    params: Record<string, any>,
    types: Record<string, string>
  ): void {
    for (const [param, value] of Object.entries(params)) {
      const expectedType = types[param];
      if (!expectedType) {
        // Skip validation for parameters not in the type registry
        continue;
      }

      const actualType = this.getType(value);
      if (actualType !== expectedType) {
        throw new GoogleApiError(
          'Invalid parameter type',
          'INVALID_PARAM_TYPE',
          `Parameter "${param}" for ${endpoint} must be of type ${expectedType}, got ${actualType}`
        );
      }
    }
  }

  private getType(value: any): string {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    if (typeof value === 'object') return 'object';
    return typeof value;
  }

  getRequiredParams(endpoint: string): string[] {
    return this.parameterRegistry[endpoint]?.required || [];
  }

  getParamTypes(endpoint: string): Record<string, string> {
    return this.parameterRegistry[endpoint]?.types || {};
  }
}
