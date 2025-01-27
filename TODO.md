# TODO

## Current Implementation Status

### Gmail Module (Implemented)
- [x] Basic email operations
  - [x] List/get messages
  - [x] Send emails
  - [x] Basic search
- [x] Advanced features
  - [x] Get user information
  - [x] Advanced search capabilities
    - [x] Search by unread status
    - [x] Search by sender
    - [x] Search by date range
    - [x] Search for emails with attachments
  - [ ] Email content management
    - [ ] get_workspace_email_content: Retrieve complete email content by ID
    - [ ] get_workspace_email_batch: Batch retrieve multiple emails by IDs
  - [ ] Draft operations
    - [ ] create_workspace_draft: Create new drafts with recipients, subject, body, and CC
    - [ ] delete_workspace_draft: Delete draft emails
  - [ ] Reply management
    - [ ] send_workspace_reply: Reply to existing emails (immediate send)
    - [ ] create_workspace_reply_draft: Save replies as drafts
  - [ ] Attachment handling
    - [ ] save_workspace_attachments: Save multiple attachments locally

### Calendar Module (In Development)
- [ ] Core functionality
  - [ ] List calendars
  - [ ] Get/create events
  - [ ] Update events
  - [ ] Delete events
- [ ] Advanced features
  - [ ] Recurring events
  - [ ] Calendar sharing
  - [ ] Free/busy queries
  - [ ] Meeting scheduling

## High Priority

### Authentication & Security
- [x] OAuth 2.0 implementation
- [x] Token refresh handling
- [x] Multi-account support
- [ ] Token encryption at rest
- [ ] Rate limiting
- [ ] Request logging

### Error Handling
- [x] Service-specific errors
- [x] Resolution guidance
- [ ] Retry mechanisms
- [ ] Circuit breakers
- [ ] Error reporting

## Medium Priority

### Performance
- [ ] Response caching
- [ ] Batch operations
- [ ] Connection pooling
- [ ] Request queuing

### Developer Experience
- [x] Basic documentation
- [ ] Integration tests
- [ ] Example projects
- [ ] Debug logging
- [ ] CLI tools

## Future Considerations

### Additional Services
- [ ] Drive API
- [ ] Admin SDK
- [ ] Sheets API
- [ ] Docs API

### Infrastructure
- [ ] Docker support
- [ ] CI/CD pipeline
- [ ] Monitoring
- [ ] Analytics

### Documentation
- [ ] Advanced guides
- [ ] Best practices
- [ ] Performance tuning
- [ ] Security hardening
