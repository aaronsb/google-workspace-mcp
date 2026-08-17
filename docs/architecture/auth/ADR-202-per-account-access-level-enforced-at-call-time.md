---
status: Accepted
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

## Update — 2026-08-17: the call-time policy landed

Four things the design above left open, settled by building it.

**The policy is always on.** Every other policy in `src/factory/safety.ts` is an operator
opt-in through `GWS_SAFETY_POLICY`. This one is not, because it enforces a choice the
*user* already made at consent time — requiring a second opt-in to honour the first would
make the first decorative. It is a no-op for read/write accounts, which is every account
by default. A test pins the wiring, since deleting it would leave the policy's own tests
green while the server stopped enforcing anything.

**Seven of 95 operations have no `resource`,** because they are custom handlers that make
several calls — and six of the seven are writes (`gmail.send`, `reply`, `replyAll`,
`forward`, `drive.upload`, `calendar.create`). Enforcing only where the descriptor has an
entry would exempt exactly the operations most worth enforcing, so those fall back to the
manifest's `type`.

That fallback was initially justified by saying the existing `type`-vs-`httpMethod` test
already pins `type`. **It does not** — that test skips any operation with no descriptor
method, which is these seven exactly, so `type` was unpinned precisely where it had become
the sole enforcement input. Retyping `gmail.send` to `list` would have disabled
enforcement for send, reply, replyAll and forward with the whole suite green. A second
test now pins the resource-less set and their declared types by equality, so an eighth
forces a decision instead of defaulting to unenforced.

**Write scopes are the read/write set minus the read-only set,** not the read/write set.
`contacts` and `meet` both carry read-only scopes *inside* their read/write set because
the service needs them at either level. Without the subtraction, a read-only contacts
account holding `directory.readonly` intersects `SERVICE_SCOPE_MAP.contacts` and a write
is permitted. Found by writing the test, not by reading the code.

**Measured, and it vindicates deriving from the descriptor:** across every action-typed
operation, exactly one is satisfiable by a read-only token — `drive.export`, which is a
GET the manifest labels an action. Google accepts `drive.readonly` for `files.export`, so
allowing it is correct. A hand-kept list of write operations would have refused a read the
token genuinely permits.

The policy **fails open** on every uncertainty: no credential, unreadable credential, no
scopes, no manifest info, unknown method. A safety check that blocks on its own doubt is
an outage, and each of these reaches Google, which refuses it independently if it should
be refused.

**Generated handlers are not everything, and the gap was real.** Code review found
`manage_scratchpad` writing to Google outside this layer entirely: its send and sync
adapters call `tasks.insert`, `events.insert`, `documents.create`,
`documents.batchUpdate`, `spreadsheets.values.update` and `sendMail` directly, because the
tool is hand-registered rather than generated. A read-only account refused `manage_docs
write` could write the same content to the same document through `manage_scratchpad send`.
The token is genuinely narrow, so Google still refused; what leaked was the explanation.

The sharper half had no Google backstop: under `GWS_SAFETY_POLICY=draft-only-email` an
ordinary read/write account could still send mail through `manage_scratchpad`, and Google
accepted it, because the token is legitimately broad. That bypass predated this ADR — but
this ADR is what made the layer load-bearing by default, which is what turned a latent
gap into one worth closing.

Closed in #171. The eight write paths now consult `evaluatePolicies` through one table
mapping each send target and sync binding to the Google method it really calls, checked at
the single dispatch point. Two consequences worth stating: **every hand-registered tool
that writes to Google must do this explicitly**, since nothing in the layer can enforce it
from the outside — that is precisely how scratchpad went uncovered; and the sync
write-backs check *before* applying the local mutation, so a refusal cannot leave the
buffer holding a change the document will never receive.

**Access is per service, and services overlap.** Docs and Sheets write methods list
`drive` among the scopes Google accepts — `documents.batchUpdate` takes
`documents|drive|drive.file`. Because the check intersects against everything granted, an
account authorized `drive` read/write *and* `docs` read-only may write documents. Google
permits it, so the policy is right to; "read-only for docs" is nevertheless not honoured
in that configuration. Per-service is the smallest unit Google sells, so this follows from
the design rather than from the implementation.

Still open: `confirmWriteAccess: true` can be sent on the first call, skipping the warning
entirely, since nothing server-side remembers having warned. Note also that the gate is
currently unreachable from any real input — every service in the map now has a read-only
scope, `meet` included via `meetings.space.readonly`. It guards the first service added
without one.

## Notes

Issue #130 proposed the consent half of this and its author offered a working branch. This ADR extends that proposal with the call-time half, which the tool-surface constraint forces. Credit for the original proposal and the `SERVICE_SCOPE_MAP_READONLY` shape is theirs.
