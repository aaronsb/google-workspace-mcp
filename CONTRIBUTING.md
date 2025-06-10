# Contributing to Google Workspace MCP

Thank you for your interest in contributing to the Google Workspace MCP project! This document provides guidelines and instructions for contributing.

## Development Setup

1. Fork and clone the repository

2. Build the development Docker image:
   ```bash
   docker build -t google-workspace-mcp:local .
   ```

3. Create a local config directory:
   ```bash
   mkdir -p ~/.mcp/google-workspace-mcp
   ```

4. Set up Google Cloud OAuth credentials:
   - Create OAuth 2.0 credentials in Google Cloud Console
   - **Important**: Choose "Web application" type (not Desktop)
   - Set redirect URI to: `http://localhost:8080`
   - Note your Client ID and Client Secret

5. Run the container with your Google API credentials:
   ```bash
   docker run -i --rm \
     -p 8080:8080 \
     -v ~/.mcp/google-workspace-mcp:/app/config \
     -e GOOGLE_CLIENT_ID=your_client_id \
     -e GOOGLE_CLIENT_SECRET=your_client_secret \
     -e LOG_MODE=strict \
     google-workspace-mcp:local
   ```

Note: For local development, you can also mount the source code directory:
```bash
docker run -i --rm \
  -p 8080:8080 \
  -v ~/.mcp/google-workspace-mcp:/app/config \
  -v $(pwd)/src:/app/src \
  -e GOOGLE_CLIENT_ID=your_client_id \
  -e GOOGLE_CLIENT_SECRET=your_client_secret \
  -e LOG_MODE=strict \
  google-workspace-mcp:local
```

**Key Development Notes**:
- Port mapping `-p 8080:8080` is required for OAuth callback handling
- OAuth credentials must be "Web application" type with `http://localhost:8080` redirect URI
- The callback server automatically starts when the OAuth client initializes

## Development Workflow

1. Create a new branch for your feature/fix:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-fix-name
   ```

2. Make your changes following our coding standards
3. Write/update tests as needed
4. Build and test your changes:
   ```bash
   # Build the development image
   docker build -t google-workspace-mcp:local .

   # Run tests in container
   docker run -i --rm \
     -v $(pwd):/app \
     google-workspace-mcp:local \
     npm test
   ```
5. Commit your changes using conventional commit messages:
   ```
   feat: add new feature
   fix: resolve specific issue
   docs: update documentation
   test: add/update tests
   refactor: code improvements
   ```

## Coding Standards

- Use TypeScript for all new code
- Follow existing code style and formatting
- Maintain 100% test coverage for new code
- Document all public APIs using JSDoc comments
- Use meaningful variable and function names
- Keep functions focused and modular
- Add comments for complex logic

## Testing Requirements

- Write unit tests for all new functionality
- Use Jest for testing
- Mock external dependencies
- Test both success and error cases
- Maintain existing test coverage
- Run the full test suite before submitting PR

## Pull Request Process

1. Update documentation for any new features or changes
2. Ensure all tests pass locally
3. Update CHANGELOG.md if applicable
4. Submit PR with clear description of changes
5. Address any review feedback
6. Ensure CI checks pass
7. Squash commits if requested

## Additional Resources

- [Architecture Documentation](ARCHITECTURE.md)
- [API Documentation](docs/API.md)
- [Error Handling](docs/ERRORS.md)
- [Examples](docs/EXAMPLES.md)

## Questions or Need Help?

Feel free to open an issue for:
- Bug reports
- Feature requests
- Questions about the codebase
- Suggestions for improvements

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
