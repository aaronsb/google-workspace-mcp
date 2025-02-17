# Contributing to Google Workspace MCP

Thank you for your interest in contributing to the Google Workspace MCP project! This document provides guidelines and instructions for contributing.

## Development Setup

1. Fork and clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy configuration examples and set up your environment:
   ```bash
   cp config/accounts.example.json config/accounts.json
   cp config/gauth.example.json config/gauth.json
   ```
4. Configure your Google API credentials in the config files

## Development Workflow

1. Create a new branch for your feature/fix:
   ```bash
   git checkout -b feature/your-feature-name
   ```
   or
   ```bash
   git checkout -b fix/your-fix-name
   ```

2. Make your changes following our coding standards
3. Write/update tests as needed
4. Run tests to ensure everything passes:
   ```bash
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
