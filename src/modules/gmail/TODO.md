# Gmail Composition Enhancements

## Overview
Enhancing Gmail composition capabilities with draft management, reply handling, and attachment support.

## Implementation Plan

### Phase 1: Draft Management
- [ ] Add types and interfaces for draft operations
- [ ] Implement `create_workspace_draft` tool
  - Support all sendEmail parameters (to, cc, bcc, subject, body)
  - Add draft ID return
  - Add optional attachment support
  - Add proper error handling
- [ ] Implement `delete_workspace_draft` tool
  - Take draft ID parameter
  - Handle non-existent drafts gracefully
- [ ] Add tests for draft operations

### Phase 2: Reply Management
- [ ] Add types for reply operations
- [ ] Implement `send_workspace_reply` tool
  - Original message ID parameter
  - Support reply-all vs single recipient
  - Include original message context
  - Support immediate sending
- [ ] Implement `create_workspace_reply_draft` tool
  - Save replies as drafts
  - Return draft ID
  - Maintain all reply-all capabilities
- [ ] Add tests for reply operations

### Phase 3: Attachment Support
- [ ] Add attachment handling types and utilities
- [ ] Implement attachment support
  - Support multiple attachments
  - Handle different MIME types
  - Implement size limits and validation
- [ ] Implement `save_workspace_attachments` tool
  - Download attachments from emails
  - Support batch operations
  - Allow specifying save location
- [ ] Add tests for attachment operations

### Phase 4: Enhanced Email Composition
- [ ] Add HTML body support to existing sendEmail
- [ ] Integrate attachment support
- [ ] Improve email validation
- [ ] Enhance error handling
- [ ] Update tests for enhanced functionality

## Documentation Updates
- [ ] Update API documentation with new features
- [ ] Add examples for each new operation
- [ ] Update type definitions

## Testing & Review
- [ ] Ensure test coverage for all new features
- [ ] Perform manual testing
- [ ] Prepare for code review

## Branch Management
- [ ] Create feature branch: `feature/gmail-composition-enhancements`
- [ ] Regular commits with clear messages
- [ ] Prepare PR with comprehensive description
