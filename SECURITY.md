# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:               |

## Reporting a Vulnerability

We take the security of Google Workspace MCP seriously. If you believe you have found a security vulnerability, please follow these steps:

1. **DO NOT** open a public issue on GitHub
2. Email your findings to aaronsb@gmail.com
3. Include detailed information about the vulnerability:
   - Description of the issue
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## What to Expect

When you report a vulnerability:

1. You'll receive acknowledgment of your report within 48 hours
2. We'll investigate and provide an initial assessment within 5 business days
3. We'll keep you informed about our progress
4. Once the issue is resolved, we'll notify you and discuss public disclosure

## Security Update Policy

1. Security patches will be released as soon as possible after a vulnerability is confirmed
2. Updates will be published through:
   - NPM package updates
   - Security advisories on GitHub
   - Release notes in our changelog

## Best Practices

When using Google Workspace MCP:

1. Always use the latest version
2. Keep your OAuth credentials secure
3. Follow our security guidelines in the documentation
4. Implement proper access controls
5. Regularly audit your token usage
6. Monitor API access logs

## Security Features

Google Workspace MCP includes several security features:

1. Secure token storage
2. OAuth 2.0 implementation
3. Rate limiting
4. Input validation
5. Secure credential handling

## Disclosure Policy

- Public disclosure will be coordinated with the reporter
- We aim to release fixes before public disclosure
- Credit will be given to security researchers who report issues (unless they prefer to remain anonymous)

## Security Contact

For security-related inquiries, contact:
- Email: aaronsb@gmail.com
- Subject line should start with [SECURITY]
