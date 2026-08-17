---
status: Proposed
date: 2026-08-17
deciders:
  - aaronsb
related:
  - ADR-103
  - ADR-300
---

# ADR-202: Per-account access level, enforced at call time

## Context

Every authenticated account gets full read/write scopes for every service it authorizes. In a multi-account setup that is more authority than most accounts need: a personal account the assistant should only ever read still hands over `gmail.modify`, `drive`, and `calendar`. Issue #130 proposes an opt-in `access: 'read' | 'readwrite'` to cut this down, and its author sketched a `SERVICE_SCOPE_MAP_READONLY` alongside the existing map.

Two constraints shape the design, and neither is obvious until you look.

### The tool surface cannot vary per account

The natural instinct — a read-only account simply doesn't see `send`, `delete`, `update` — cannot work. MCP advertises `tools/list` **once per server**, at startup. The account is a *parameter* on every operation, chosen per call. There is no per-account tool instance to filter. A server serving one read-only and two read-write accounts advertises exactly one `manage_email`, and it must be the same one for all three.

So the enforcement point is the **call**, not the schema.

### The scope split is real, but not derivable from names

Measured across every method in `descriptor.json`: `calendar`, `docs`, `gmail`, `meet` and `tasks` have a read-only scope covering *every* GET method they expose. `drive` has two GET methods with no read-only option; `sheets` has one. So asking for less at consent time genuinely works for most of the surface.

What does not work is inferring read-ness from the scope name. Google lists **every** scope that can authorize a method, and some scopes with "readonly" in the name still allow small writes — `files.copy` accepts `drive.photos.readonly`, `files.update` accepts `drive.metadata`. A rule of "this method lists a readonly scope, so it is safe under read access" would expose both as reads. The manifest's own `type:` field (`list` / `detail` / `action`) is the better signal and agrees with `httpMethod` on 78 of 80 operations; the two disagreements are `calendar.freebusy` (a read shaped as POST) and `drive.export` (declared `action`, actually GET).

## Decision

Access level is **per account, per service**, chosen at consent time, and enforced at call time.

### Consent time — ask for less where Google allows it

`scopesForServices(services, access)` gains an access argument, defaulting to `'readwrite'` so every existing account is unaffected. A second map supplies the read-only scope for services that have one.

Where a service has **no** read-only scope, the request does not quietly ask for more. #130's sketch proposed falling back to the read/write scope; that means someone who asked for read access gets write access without being told, which is consent in name only. Instead the person is told which services will still be able to write, and what they will actually be granting, before the browser opens.

The chosen access level is **stored with the account**, because nothing else records what an account was authorized *for*. Its granted scopes say what the token can do; they do not say whether a human chose to hold it back. `status` reads it, and the call-time policy below needs it.

Stored alongside it: the services that will still be able to write. An account confirmed through `confirmWriteAccess` holds `access: 'read'` and write scopes for those services, so the level alone would misdescribe it.

### Call time — a scope-aware safety policy

`src/factory/safety.ts` already intercepts operations before execution, with the calling account in `PatchContext` and the ability to block with a written reason — the mechanism behind `draft-only-email` and `no-delete`. Access enforcement is one more policy in that layer:

1. Read the calling account's granted scopes from its credential file.
2. Look up the operation's required scopes in `descriptor.json`.
3. If nothing intersects, block, naming the account, the operation, and the fix.

Every account sees the same tools. A read-only account calling a write operation is intercepted with an explanation; a read-write account is unaffected. The message says what happened and what to do:

```
manage_docs 'write' needs write access to docs.
Account someone@example.com was authorized read-only for docs.
Re-authorize with manage_accounts {operation:'scopes', email:'someone@example.com',
services:'docs', access:'readwrite'}, or use an account that already has it.
```

### Why derive rather than declare

The per-method scope list is already in `descriptor.json`, regenerated from Discovery (ADR-103). A hand-maintained table of which operations are writes would be a second source of truth that drifts the moment an operation is added — the failure ADR-103 exists to prevent, and the same shape as #161, where a hand-maintained description silently diverged from what the model was told.

The manifest's `type:` is the declared intent; the descriptor's `httpMethod` and scope list are what Google actually requires. Enforcement uses the descriptor; a test asserts the two agree, so a new operation whose `type` misdescribes it fails the suite instead of misclassifying at runtime.

## Consequences

### Positive

- An account can be given only the access it needs, without giving up multi-account convenience. A token that can only read limits the damage from anything the model is talked into by content it reads.
- The block happens before the API call, so the agent gets a sentence naming the account and the remedy instead of a Google 403 it has to interpret.
- The same precheck catches a gap that exists today: an account that authorized only `gmail` and then calls `manage_drive` currently gets an opaque 403. It will now be told it never granted drive.
- Enforcement is derived from the descriptor, so a new operation is covered the moment it is added.

### Negative

- Access level has to persist per account, which changes the credential file shape and needs a migration path for accounts written before this.
- Every intercepted operation costs a credential-file read. Cheap and cacheable, but not free.
- Access is set per service, not per operation. An account that needs `manage_drive upload` but nothing else destructive still takes the full `drive` scope, because a whole service is the smallest thing Google lets you ask for.

### Neutral

- Read-only accounts still see write operations in the tool schema. This is a property of MCP, not a choice, and the block message has to carry the weight the schema cannot.
- `drive` and `sheets` have GET methods with no read-only scope, so read access to those two allows less than full access but still slightly more than reading. The consent step must say so rather than implying a clean split.

## Alternatives Considered

- **Filter the tool schema per account.** The intuitive design, and impossible: `tools/list` is served once per server and the account is a per-call parameter. Recorded here because it is the first thing anyone proposes.
- **Fall back to the read/write scope when no read-only exists** (#130's sketch). Rejected: a request for read access that quietly yields write access hands over more than was asked for, the same defect class as quietly returning less than was asked for, and worse because it is about permission. Naming the services that will still be able to write costs one message and keeps the words "read access" honest.
- **A hand-maintained list of write operations.** Rejected as a second source of truth that drifts. The descriptor already knows.
- **Enforce only at the token.** Simplest — let Google reject the call. Rejected because the agent gets a 403 with no idea which account, which scope, or how to fix it, and because the failure arrives after the request has left.
- **Per-operation access levels.** More precise than per-service, and not something Google sells: its scopes cover whole services, so per-operation limits would be enforced entirely by us while the token stayed broad. The gap between what the token permits and what we enforce is exactly where a bypass lives.

## Notes

Issue #130 proposed the consent half of this and its author offered a working branch. This ADR extends that proposal with the call-time half, which the tool-surface constraint forces. Credit for the original proposal and the `SERVICE_SCOPE_MAP_READONLY` shape is theirs.
