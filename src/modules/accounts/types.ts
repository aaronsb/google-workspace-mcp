import { OAuth2Client } from 'google-auth-library';

export interface Account {
  email: string;
  category: string;
  description: string;
  auth_status?: {
    valid: boolean;
    token?: any;
    reason?: string;
    authUrl?: string;
    requiredScopes?: string[];
  };
}

export interface AccountsConfig {
  accounts: Account[];
}

export interface TokenStatus {
  valid: boolean;
  token?: any;
  reason?: string;
  authUrl?: string;
  requiredScopes?: string[];
}

export interface AuthenticationError extends AccountError {
  authUrl: string;
  requiredScopes: string[];
}

export interface AccountModuleConfig {
  accountsPath?: string;
  oauth2Client?: OAuth2Client;
}

export class AccountError extends Error {
  constructor(
    message: string,
    public code: string,
    public resolution: string
  ) {
    super(message);
    this.name = 'AccountError';
  }
}
