# TODO

## Current Implementation Status

### Gmail Module (Implemented)
- [x] Basic email operations
  - [x] List/get messages
  - [x] Send emails
  - [x] Basic search
- [ ] Advanced features
  - [ ] Get user information
  - [ ] Advanced search capabilities
    - [ ] Search by unread status
    - [ ] Search by sender
    - [ ] Search by date range
    - [ ] Search for emails with attachments
  - [ ] Email management
    - [ ] Retrieve complete email content by ID
    - [ ] Batch retrieve multiple emails by IDs
  - [ ] Draft management
    - [ ] Create new drafts with recipients, subject, body, and CC
    - [ ] Delete draft emails
  - [ ] Reply handling
    - [ ] Reply to existing emails (immediate send)
    - [ ] Save replies as drafts
  - [ ] Attachment handling
    - [ ] Save multiple attachments locally

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
