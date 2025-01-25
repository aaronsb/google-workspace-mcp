// Account Types
export interface Account {
  email: string;
  category: string;
  description: string;
}

export interface AccountsConfig {
  accounts: Account[];
}

// Token Types
export interface TokenData {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  expiry_date: number;
  last_refresh: number;
}

// OAuth Config Types
export interface OAuthConfig {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  auth_uri: string;
  token_uri: string;
}

// API Request Types
export interface GoogleApiRequestParams {
  email: string;
  category?: string;
  description?: string;
  api_endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, any>;
  required_scopes: string[];
  auth_code?: string;
}

// API Response Types
export type GoogleApiResponse = 
  | {
      status: 'success';
      data?: any;
      message?: string;
    }
  | {
      status: 'auth_required';
      auth_url: string;
      instructions: string;
    }
  | {
      status: 'refreshing';
      message: string;
    }
  | {
      status: 'error';
      error: string;
      resolution?: string;
    };

// Error Types
export class GoogleApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly resolution?: string
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

// Utility Types
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface ApiRequestParams {
  endpoint: string;
  method: HttpMethod;
  params?: Record<string, any>;
  token: string;
}
