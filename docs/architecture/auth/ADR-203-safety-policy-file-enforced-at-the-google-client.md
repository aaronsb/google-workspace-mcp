---
contract: adr/v1
kind: decision
verb: change
capability:
  - auth
  - core
basis:
  - operator: aaronsb
    level: guided
    said: "what about a policy config glob in the mcp parameters? we could begin setting policy options there, with a default conservative that is generally how it is today I want to avoid the constructive multi session avoidance somehow (draft to x@evil.com, in new session, write a message to self to send to x@evil.com)"
    via: Claude Code session, 2026-10-27, after the security review of PRs #201, #213, #215 and #216
  - operator: aaronsb
    level: directed
    said: "there's only so much we can do to protect a .mcp.json - so I'd say that we assume that anything offering the mcp server to the agent has handled it's configuration space itself."
    via: Claude Code session, 2026-10-27
  - operator: aaronsb
    level: directed
    said: "the default can be basically how it is now, (tbd, we could update the default later) and in the repo, a default template. I think we have actually fenced off the api tokens etc from the agent for the configuration store ( the oauth ) so that's likely the same safe enclave to keep the policy. on very first start, if the file doesn't exist, the mcp server writes the default template. if the file exists and is validated, it doesn't touch it and reads it. if there are properties that are invalid or keys and values that are invalid, we write an error and fail to start it. (with a message in the error that deleting the file will allow a fresh valid default to be generated)"
    via: Claude Code session, 2026-10-27
  - evidence: "Review of PR #216 found two plausible follow-up changes that would each open a send path under draft-only-email without touching safety.ts: an operation calling users.drafts.send, and passing real params into the scratchpad policy check, whose email target sends regardless of draft"
  - evidence: "descriptor.json gives all 257 methods an httpMethod: 104 GET, 153 writes, of which four POST methods are reads"
  - precedent: ADR-103
  - precedent: ADR-202
agent:
  name: claude-code
  model: claude-opus-5-5
status: proposed
date: 2026-10-27
deciders:
  - aaronsb
related:
  - ADR-103
  - ADR-202
  - ADR-301
---

# ADR-203: Safety policy file, enforced at the Google client

## Summary

- **Decided:** Safety policy moves from a list of names in `GWS_SAFETY_POLICY` to a validated file in the config store, written from a template on first start, refusing to start when invalid. It is enforced inside the Google client on the Google method being called and the recipients it would actually reach, so a new operation or path is covered without anyone remembering the policy. The default template keeps today's behavior.
- **Trades away:** Parsing outgoing messages and an extra fetch before a draft is sent; a committed classification of every write method to maintain; no defense against a host agent that edits or deletes the policy file.
- **One-way?** No. Reversible now; expensive once operators rely on the file format, which is why it carries a `version`.
- **Probes:** *Confident:* a draft addressed outside the recipient allowlist is refused as a draft, which is what breaks the "draft to x@evil.com, send it in a later session" chain. *Not confident:* that drafts should be held to the send allowlist by default (`drafts: same-as-send`) rather than allowed to any address for a human to review.
- **Inversion:** Between trusting each handler to describe its own effect and tracking intent across sessions. The answer is outside both: constrain the destination at the one place every request passes.

## Context

Safety policies today are a comma-separated list of names in `GWS_SAFETY_POLICY` (`draft-only-email`, `no-delete`, `read-only`, `audit`). Each policy is a function that runs before a handler, sees the tool's operation name and the caller's params, and allows or blocks the call. Two properties of that design limit what it can promise.

### Policies classify by our names and trust the caller's params

`draft-only-email` blocks a fixed list of operation names. `read-only` treats an operation as a read when its name starts with `get`, `list` or `search`. A new operation, a new handler or a new scratchpad target is covered only if whoever adds it remembers the policy. Review of PR #216 found two plausible follow-up changes that would each open a send path under `draft-only-email` without touching `safety.ts`: an operation that calls `users.drafts.send` (the method is already in the descriptor), and passing real params into the scratchpad's policy check, whose `email` target sends regardless of `draft`. #216 itself moves the policy from "these operations are blocked" to "these operations are blocked unless `params.draft` says the handler will only draft", so the policy's correctness depends on every handler agreeing with that predicate.

### Per-call checks cannot see a chain across sessions

Every policy evaluates one call. An agent restricted from sending can stage the parts of a send in steps that each pass: create a draft addressed to an outside address, or mail itself a note asking a later session to send something there. The later session, or a person clicking Send in Gmail, completes it. The state that connects the steps lives in Google (drafts, mail, Drive files, calendar events), not in this server, and no session boundary carries the intent with it. What stays constant across sessions is the destination.

### Every request already passes one seam

ADR-103 routes every Google request through the client we own (`call`, `upload`, `download` in `src/google/client.ts`). Generated handlers, custom handlers, batch, the scratchpad and the Gmail mail helper all reach Google there. The descriptor gives each of its 257 methods an `httpMethod`: 104 are `GET`, and four `POST` methods are reads (`calendar.freebusy.query`, `sheets.spreadsheets.getByDataFilter`, `sheets.spreadsheets.values.batchGetByDataFilter`, `sheets.spreadsheets.developerMetadata.search`). Classification by Google method is therefore derivable from data we already generate, rather than from operation names we invent.

### The config store is already fenced from the agent

Credentials live under `dataDir()/credentials` and the account registry at `configDir()/accounts.json`. No tool reads or writes either: the server's file I/O is jailed to `WORKSPACE_DIR` with path and symlink checks (`src/executor/workspace.ts`). The default workspace is a sibling of the credentials directory, not a parent of it. `validateWorkspaceDir` does not, however, refuse a workspace configured as a parent of the config or data directory.

## Decision

### 1. Policy lives in a file in the config store

The server reads `configDir()/safety-policy.yaml`, beside `accounts.json`.

- **First start, no file:** the server writes the default template, then reads it.
- **File exists and validates:** the server reads it and never rewrites it.
- **File exists and does not validate:** the server writes an error to stderr and exits non-zero. The error names the file, each invalid key or value, and says that deleting the file lets a fresh valid default be generated on the next start.

Validation is strict. Unknown keys, wrong types, unknown preset names and method globs that match no descriptor method are all errors, so a typo cannot silently disable a rule.

The default template is committed in the repository and shipped in the package. Its rules reproduce today's default behavior: no presets, any recipient, unclassified writes allowed. Changing the default is a later decision.

`validateWorkspaceDir` refuses a workspace that contains `configDir()` or `dataDir()`, so no tool path can reach the policy file or the credentials.

### 2. The host owns the configuration space

Whatever launches the server (an MCP client config, a `.mcpb` install, a container) is responsible for keeping the agent away from the server's environment and config store. The server treats the policy it is given as the operator's intent. It does not hash, pin or permission-check the file, and it does not defend against an agent that can edit the host's MCP configuration or delete the policy file.

### 3. Enforcement happens at the Google client, keyed by Google method

The policy is evaluated inside the client seam, on the Google method about to be called and the arguments actually being sent. Rules match `service.method` globs over descriptor names (for example `gmail.users.drafts.*`), not tool operation names, and never consult a caller-supplied flag about what a handler intends to do.

Every non-`GET` descriptor method is listed in a committed classification as a read (the four `POST` reads), a delivery method (below), or a plain write. A build-time conformance test fails when a descriptor method is missing from the classification, so a newly generated method needs an explicit decision before it ships.

`unclassified: block` in the policy file makes any write method that no rule names fail closed at runtime. The default template sets `unclassified: allow`.

The existing pre-handler `evaluatePolicies` call stays for early, readable refusals, but the client check is authoritative. A request it blocks never leaves the process, whichever path built it.

### 4. Delivery methods are checked on resolved recipients

A delivery method is one whose effect reaches an address: Gmail send and draft methods, forwarding filters, Drive and Calendar sharing, and calendar events with attendees. Each has an extractor that resolves the addresses from the request as built, not from the tool's params:

| Methods | Addresses resolved from |
|---|---|
| `gmail.users.messages.send`, `gmail.users.drafts.create`, `gmail.users.drafts.update` | To, Cc and Bcc of the RFC 822 message being uploaded |
| `gmail.users.drafts.send` | To, Cc and Bcc of the stored draft, fetched before the send |
| `gmail.users.settings.filters.create` | the filter's `forward` address |
| `drive.permissions.create`, `drive.permissions.update` | the grantee's email or domain; `type: anyone` is its own rule |
| `calendar.events.insert`, `calendar.events.update`, `calendar.events.patch`, `calendar.events.import`, `calendar.acl.insert` | attendee and grantee addresses |

The policy file holds a recipient allowlist of address globs, with `self` meaning the acting account. Drafts are held to the same list as sends unless the file sets `drafts: any`. Because the check runs on resolved addresses at the seam, it holds in every session regardless of which session staged the content, and a reply that inherits a hostile `Reply-To` is checked against the address it would actually reach.

A delivery method without an extractor fails the conformance test.

### 5. `GWS_SAFETY_POLICY` remains as presets that compose

Each existing policy name becomes a preset defined in the same rule vocabulary (`draft-only-email` blocks `gmail.users.messages.send` and `gmail.users.drafts.send` and leaves drafts to the recipient rules; `read-only` blocks every method classified as a write). Presets named in the environment and in the file all apply, and any block wins, so the environment can only tighten the file. `account-access` (ADR-202) stays always on.

### 6. Account widening is a policy rule

`manage_accounts` `authenticate` and `scopes` requests for `access: readwrite` never reach the Google client, so they get their own rule (`accounts.widen: allow | block`). The default allows them, matching today.

### Default template (shape, not final syntax)

```yaml
# google-workspace-mcp safety policy. Delete this file to regenerate the default.
version: 1
presets: []                 # draft-only-email, no-delete, read-only, audit
recipients:
  allow: ["*"]              # address globs; "self" is the acting account
  drafts: same-as-send      # or: any
methods: {}                 # "service.method glob": allow | block
unclassified: allow         # block: writes no rule names fail closed
accounts:
  widen: allow              # block: refuse authenticate/scopes asking for readwrite
```

## Consequences

### Positive

- A new operation, handler or scratchpad target is covered on day one, because enforcement sees the Google method it ends up calling.
- `draft-only-email` no longer depends on handlers and the policy agreeing about `params.draft`: the client sees whether the request is `drafts.create` or `messages.send`.
- A recipient allowlist holds across sessions. Staging a draft or a self-addressed note does not help an agent reach an address the policy refuses.
- Drive sharing and calendar invitations, which reach outside addresses and are not covered by any policy today, come under the same rules.
- Operators get one validated, commented file in the place they already find `accounts.json`, and a broken file stops the server instead of weakening it.

### Negative

- Recipient extraction means parsing outgoing RFC 822 messages and, for `drafts.send`, an extra fetch before every send.
- A block at the client can land partway through a custom handler after its reads have run. The handler must surface the refusal cleanly, and multi-step writes must not leave half-done state.
- The classification of all 153 write methods is a committed list someone has to maintain as the descriptor grows. The conformance test makes that visible rather than optional.
- An agent with shell access on the host can still delete or edit the policy file, and deletion regenerates the permissive default. This is accepted under decision 2.

### Neutral

- PR #216's goal (threaded reply drafts under `draft-only-email`) becomes a consequence of the preset rather than a special case in `safety.ts`.
- Mail from `self` stays readable and is still a carrier for instructions to a later session. Treating it as untrusted content is spotlighting work (#183), not part of this decision.
- `account-access` could move to the client seam on the same terms; it is left where it is.

## Alternatives Considered

- **Harden the name-based policies** (resource-tagged block list, a shared `isDraftRequested` predicate, a test that enumerates operations). Closes the two known follow-up paths but keeps coverage dependent on our operation names and on handlers matching the policy's predicate. Rejected as the end state; parts of it survive as the method classification and conformance test.
- **Policy as a glob in the MCP launch parameters.** Considered first. Environment values are awkward to validate, comment and diff, and the config store is already the place the agent cannot reach through this server. Kept only as `GWS_SAFETY_POLICY` presets for existing deployments.
- **Track intent across sessions** (taint drafts or messages the agent created and refuse to send them later). The connecting state lives in Google, any session boundary loses it, and a person clicking Send is outside it. Constraining the destination needs no memory.
- **Protect the configuration from the host agent** (file permissions, hash pinning, refusing to start when the file is writable). Rejected: the host that offers the server to an agent owns that boundary, and the server cannot enforce it against a process with the same user's shell.
- **Make the default conservative now.** Deferred. Today's default is permissive, and changing it breaks existing deployments; the template makes a later change a one-file decision.
