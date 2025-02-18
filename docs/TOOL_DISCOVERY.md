# Tool Discovery and Aliases

The Google Workspace MCP server provides several features to make tools more discoverable and easier to use:

## Tool Categories

Tools are organized into logical categories for better organization:

- Account Management
  - Authentication and account management tools
- Gmail/Messages
  - Email composition and search
- Gmail/Labels
  - Label creation and management
- Gmail/Drafts
  - Draft email management
- Gmail/Settings
  - Gmail settings and configuration
- Calendar/Events
  - Calendar event management

## Tool Aliases

Most tools support multiple aliases for more intuitive usage. For example:

```javascript
// All of these are equivalent:
create_workspace_label
create_label
new_label
create_gmail_label
```

## Improved Error Messages

When a tool name is not found, the server provides helpful suggestions:

```
Tool 'create_gmail_lable' not found.

Did you mean:
- create_workspace_label (Gmail/Labels)
  Aliases: create_label, new_label, create_gmail_label

Available categories:
- Gmail/Labels: create_label, update_label, delete_label
- Gmail/Messages: send_email, search_emails
- Calendar/Events: create_event, update_event, delete_event
```

## Tool Metadata

Each tool includes:

- Category: Logical grouping for organization
- Aliases: Alternative names for the tool
- Description: Detailed usage information
- Input Schema: Required and optional parameters

## Best Practices

1. Use the most specific tool name when possible
2. Check error messages for similar tool suggestions
3. Use the list_workspace_tools command to see all available tools
4. Refer to tool categories for related functionality

## Examples

### Creating a Label

```javascript
// Any of these work:
create_workspace_label({
  email: "user@example.com",
  name: "Important/Projects"
})

create_label({
  email: "user@example.com",
  name: "Important/Projects"
})

create_gmail_label({
  email: "user@example.com",
  name: "Important/Projects"
})
```

### Sending an Email

```javascript
// These are equivalent:
send_workspace_email({
  email: "user@example.com",
  to: ["recipient@example.com"],
  subject: "Hello",
  body: "Message content"
})

send_email({
  email: "user@example.com",
  to: ["recipient@example.com"],
  subject: "Hello",
  body: "Message content"
})
```

## Future Improvements

- Category descriptions and documentation
- Tool relationship mapping
- Common usage patterns and workflows
- Interactive tool discovery
