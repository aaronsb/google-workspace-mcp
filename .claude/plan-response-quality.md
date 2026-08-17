# Plan: Response Quality — Formatting Facade + Queue + Auth Lifecycle

Borrow proven patterns from jira-cloud MCP to improve how this server
communicates with LLM agents. Three workstreams, ordered by dependency.

## 1. Formatting Facade (branch: `feature/formatting-facade`)

**Problem:** Handlers return raw JSON objects. Agents get unformatted data
and have to figure out what's important. Jira MCP returns rich, token-efficient
markdown with semantic markers that agents parse instantly.

**Borrow from jira-cloud:**
- Pipe-delimited compact fields for list items
- Semantic status markers (`[x]`, `[ ]`, `[>]`)
- Truncation for long content (snippets, descriptions)
- Pagination guidance inline when results are capped
- People/attendee formatting with actionable identifiers

**Changes:**

| File | What |
|------|------|
| `src/server/formatting/markdown.ts` | Rewrite formatters to return markdown strings, not JSON objects |
| `src/server/formatting/next-steps.ts` | Append as markdown footer (like jira), not separate JSON key |
| Handler files (email, calendar, drive) | Return `{ content: [{ type: 'text', text: markdown }] }` |

**Email list example (before → after):**
```
Before: { emails: [{ id: "msg-1", from: "alice@test.com", subject: "Hello" }], count: 1 }

After:
# Inbox (3 messages)
msg-1 | alice@test.com | Hello | Mar 14
msg-2 | bob@test.com | Meeting notes | Mar 13
msg-3 | carol@test.com | Re: Project update | Mar 12

---
**Next steps:**
- Read a specific email: `manage_email` — `{ "operation": "read", "email": "user@gmail.com", "messageId": "<id>" }`
```

**Calendar event example:**
```
# Today's Agenda (2 events)
[>] 09:00–09:30 | Standup | Room A | 3 attendees
[ ] 14:00–15:00 | Design Review | (no location) | 5 attendees
```

**Scope:** Format functions, handler return shapes, next-steps rendering.
Tests will need updating to match new output shapes.

## 2. Queue Enhancement (branch: `feature/queue-enhancement`)

**Problem:** Queue strips next_steps and returns bare JSON results. No
summary mode, no consolidated guidance. Jira queue has summary vs full
detail modes and appends consolidated next-steps based on last successful op.

**Borrow from jira-cloud:**
- Summary mode: one-line status + icon per operation
- Full mode: complete output from each operation
- Consolidated next-steps from last successful operation's context
- `detail` parameter: `'summary' | 'full'` (default: full)

**Changes:**

| File | What |
|------|------|
| `src/server/queue.ts` | Add `detail` param, summary rendering, consolidated next-steps |
| `src/server/tools.ts` | Add `detail` property to queue_operations schema |

**Summary mode example:**
```
# Queue Results (3/3 succeeded)
✓ manage_email search — 5 emails found
✓ manage_email read — msg-1 from alice@test.com
✓ manage_email reply — sent

---
**Next steps:**
- Check inbox for replies: `manage_email` — `{ "operation": "triage", ... }`
```

**Depends on:** Workstream 1 (formatters must return markdown for summary to extract headlines).

## 3. Auth Lifecycle (branch: `adr-200-auth-lifecycle`)

**Problem:** `manage_accounts` has 3 operations (list, authenticate, remove).
ADR-200 designs 7 operations for full lifecycle management. Users still need
to touch `gws` CLI directly for setup, status checks, and scope changes.

**Implements ADR-200. New operations:**

| Operation | What it does |
|-----------|-------------|
| `setup` | First-time Cloud project creation via `gws auth setup` |
| `status` | Check token validity + scopes via `gws auth status` |
| `refresh` | Re-export credential from gws encrypted store |
| `scopes` | Re-auth with different scope selection |

**Changes:**

| File | What |
|------|------|
| `src/accounts/auth.ts` | Add setup, status, refresh, scopes flows |
| `src/accounts/registry.ts` | Enrich list with token validity + scopes |
| `src/server/handlers/accounts.ts` | Wire new operations |
| `src/server/tools.ts` | Expand manage_accounts schema |
| `src/server/formatting/next-steps.ts` | Auth-aware error guidance |

**Error guidance (from ADR-200):**
- "Token expired" → suggest `{ "operation": "authenticate", "email": "..." }`
- "Invalid client" → suggest `{ "operation": "setup" }`
- "Insufficient scopes" → suggest `{ "operation": "scopes", "email": "...", "services": "drive,gmail" }`

**Depends on:** Workstream 1 (status/list output should use the new formatting).

## Build Order

```
1. feature/formatting-facade     ← standalone, unblocks everything
2. feature/queue-enhancement     ← depends on 1
3. adr-200-auth-lifecycle        ← depends on 1, parallel with 2
```

## What NOT to do

- Don't add Jira-style analytics/metrics — GWS is operations-focused
- Don't add expand arrays — Google API responses are already full
- Don't add DSL/computed columns — no analysis dimension here
- Don't add bulk operation guards — no destructive bulk ops in GWS
