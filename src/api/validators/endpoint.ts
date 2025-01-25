import { GoogleApiError } from '../../types.js';

interface ServiceConfig {
  version: string;
  methods: string[];
  scopes: Record<string, string[]>;
}

export class EndpointValidator {
  // Registry of supported services and their configurations
  private readonly serviceRegistry: Record<string, ServiceConfig> = {
    gmail: {
      version: 'v1',
      methods: [
        'users.messages.list',
        'users.messages.get',
        'users.messages.send',
        'users.labels.list',
        'users.labels.get',
        'users.drafts.list',
        'users.drafts.get',
        'users.drafts.create',
        'users.drafts.update',
        'users.drafts.delete'
      ],
      scopes: {
        'users.messages.list': ['https://www.googleapis.com/auth/gmail.readonly'],
        'users.messages.get': ['https://www.googleapis.com/auth/gmail.readonly'],
        'users.messages.send': ['https://www.googleapis.com/auth/gmail.send'],
        'users.labels.list': ['https://www.googleapis.com/auth/gmail.labels'],
        'users.labels.get': ['https://www.googleapis.com/auth/gmail.labels'],
        'users.drafts.list': ['https://www.googleapis.com/auth/gmail.readonly'],
        'users.drafts.get': ['https://www.googleapis.com/auth/gmail.readonly'],
        'users.drafts.create': ['https://www.googleapis.com/auth/gmail.compose'],
        'users.drafts.update': ['https://www.googleapis.com/auth/gmail.compose'],
        'users.drafts.delete': ['https://www.googleapis.com/auth/gmail.compose']
      }
    },
    drive: {
      version: 'v3',
      methods: [
        'files.list',
        'files.get',
        'files.create',
        'files.update',
        'files.delete',
        'files.copy',
        'permissions.list',
        'permissions.get',
        'permissions.create',
        'permissions.update',
        'permissions.delete'
      ],
      scopes: {
        'files.list': ['https://www.googleapis.com/auth/drive.readonly'],
        'files.get': ['https://www.googleapis.com/auth/drive.readonly'],
        'files.create': ['https://www.googleapis.com/auth/drive.file'],
        'files.update': ['https://www.googleapis.com/auth/drive.file'],
        'files.delete': ['https://www.googleapis.com/auth/drive.file'],
        'files.copy': ['https://www.googleapis.com/auth/drive.file'],
        'permissions.list': ['https://www.googleapis.com/auth/drive.readonly'],
        'permissions.get': ['https://www.googleapis.com/auth/drive.readonly'],
        'permissions.create': ['https://www.googleapis.com/auth/drive.file'],
        'permissions.update': ['https://www.googleapis.com/auth/drive.file'],
        'permissions.delete': ['https://www.googleapis.com/auth/drive.file']
      }
    }
  };

  async validate(endpoint: string): Promise<void> {
    // Parse endpoint into service and method
    const [service, ...methodParts] = endpoint.split('.');
    const methodName = methodParts.join('.');

    // Validate service exists
    if (!service || !this.serviceRegistry[service]) {
      throw new GoogleApiError(
        `Service "${service}" is not supported`,
        'INVALID_SERVICE',
        `Supported services are: ${Object.keys(this.serviceRegistry).join(', ')}`
      );
    }

    // Validate method exists
    const serviceConfig = this.serviceRegistry[service];
    if (!methodName || !serviceConfig.methods.includes(methodName)) {
      throw new GoogleApiError(
        `Method "${methodName}" is not supported for service "${service}"`,
        'INVALID_METHOD',
        `Available methods for ${service} are: ${serviceConfig.methods.join(', ')}`
      );
    }
  }

  getRequiredScopes(endpoint: string): string[] {
    const [service, ...methodParts] = endpoint.split('.');
    const methodName = methodParts.join('.');

    const serviceConfig = this.serviceRegistry[service];
    if (!serviceConfig || !serviceConfig.scopes[methodName]) {
      return [];
    }

    return serviceConfig.scopes[methodName];
  }

  getSupportedServices(): string[] {
    return Object.keys(this.serviceRegistry);
  }

  getSupportedMethods(service: string): string[] {
    return this.serviceRegistry[service]?.methods || [];
  }
}
