---
contract: adr/v1
kind: decision
verb: change
capability: [safety, client]
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
  - operator: aaronsb
    level: directed
    said: "I'm actually not sure now, and considering this might be too complex in a policy that we shouldnt' be performing"
    via: Claude Code session, 2026-10-27, on recipient allowlists for drafts; followed by "lets make the edits."
  - evidence: "Review of PR #216 found two plausible follow-up changes that would each open a send path under draft-only-email without touching safety.ts: an operation calling users.drafts.send, and passing real params into the scratchpad policy check, whose email target sends regardless of draft"
  - evidence: "descriptor.json gives all 257 methods an httpMethod: 104 GET, 153 writes, of which four POST methods are reads"
  - precedent: ADR-103
  - precedent: ADR-202
agent:
  name: claude-code
  model: claude-opus-5-5
considered:
  - operator: aaronsb
    said: "- Should a draft addressed outside the allowlist be refused even as a draft? <- yes\n    - Should drafts be held to the send allowlist by default? <- no"
    via: Claude Code session, 2026-10-27, answering the Summary probes
    covers: [draft-refusal, draft-default]
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

- **Decided:** Safety policy moves from a list of names in `GWS_SAFETY_POLICY` to a validated file in the config store, written from a template on first start, refusing to start when invalid. It is enforced inside the Google client on the Google method being called, so a new operation, handler or path is covered without anyone remembering the policy, and no session under a sending ban can send. The default template keeps today's behavior.
- **Trades away:** Rules cannot say "send, but only to these addresses"; a committed classification of every write method to maintain; no defense against a host agent that edits or deletes the policy file.
- **One-way?** No. Reversible now; expensive once operators rely on the file format, which is why it carries a `version`.
- **Probes:** *Confident (method-block):* under `draft-only-email`, no path in any session can call a Gmail send method, and a person clicking Send on a draft remains the review step the preset is built around. *Not confident (share-rules):* that Drive sharing and calendar invitations belong in operator method rules rather than in the `draft-only-email` preset itself.
- **Inversion:** Between trusting each handler to describe its own effect and tracking intent across sessions. The answer is outside both: refuse the method at the one place every request passes.

## Context

Safety policies today are a comma-separated list of names in `GWS_SAFETY_POLICY` (`draft-only-email`, `no-delete`, `read-only`, `audit`). Each policy is a function that runs before a handler, sees the tool's operation name and the caller's params, and allows or blocks the call. Two properties of that design limit what it can promise.

### Policies classify by our names and trust the caller's params

`draft-only-email` blocks a fixed list of operation names. `read-only` treats an operation as a read when its name starts with `get`, `list` or `search`. A new operation, a new handler or a new scratchpad target is covered only if whoever adds it remembers the policy. Review of PR #216 found two plausible follow-up changes that would each open a send path under `draft-only-email` without touching `safety.ts`: an operation that calls `users.drafts.send` (the method is already in the descriptor), and passing real params into the scratchpad's policy check, whose `email` target sends regardless of `draft`. #216 itself moves the policy from "these operations are blocked" to "these operations are blocked unless `params.draft` says the handler will only draft", so the policy's correctness depends on every handler agreeing with that predicate.

### A send staged across sessions ends in a send method or a person

Every policy evaluates one call. An agent restricted from sending can stage the parts of a send in steps that each pass: create a draft addressed to an outside address, or mail itself a note asking a later session to send something there. The state that connects the steps lives in Google, not in this server, so no per-call check can follow it. The chain still has to end in one of two places: a call to a Gmail send method, or a person clicking Send. A ban on the method that holds on every path in every session closes the first. The second is the review step a draft-only deployment exists to keep.

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

The default template is committed in the repository and shipped in the package. Its rules reproduce today's default behavior: no presets, no method rules, unclassified writes allowed. Changing the default is a later decision.

`validateWorkspaceDir` refuses a workspace that contains `configDir()` or `dataDir()`, so no tool path can reach the policy file or the credentials.

### 2. The host owns the configuration space

Whatever launches the server (an MCP client config, a `.mcpb` install, a container) is responsible for keeping the agent away from the server's environment and config store. The server treats the policy it is given as the operator's intent. It does not hash, pin or permission-check the file, and it does not defend against an agent that can edit the host's MCP configuration or delete the policy file.

### 3. Enforcement happens at the Google client, keyed by Google method

The policy is evaluated inside the client seam, on the Google method about to be called. Rules match `service.method` globs over descriptor names (for example `drive.permissions.*`), not tool operation names, and never consult a caller-supplied flag about what a handler intends to do.

The existing pre-handler `evaluatePolicies` call stays for early, readable refusals, but the client check is authoritative. A request it blocks never leaves the process, whichever path built it.

### 4. Every write method is classified

Every non-`GET` descriptor method is listed in a committed classification under one of four classes:

| Class | Members |
|---|---|
| read | the four `POST` methods that only read |
| send | `gmail.users.messages.send`, `gmail.users.drafts.send` |
| reach | methods whose effect reaches another person: `drive.permissions.create` and `update`, `calendar.acl.insert`, calendar event writes that can carry attendees, `gmail.users.settings.filters.create` |
| write | every other method |

A build-time conformance test fails when a descriptor method is missing from the classification, so a newly generated method needs an explicit decision before it ships. Rules may name a class as well as a glob.

`unclassified: block` in the policy file makes any write method that no rule names fail closed at runtime. The default template sets `unclassified: allow`.

### 5. `GWS_SAFETY_POLICY` remains as presets that compose

Each existing policy name becomes a preset defined in the same rule vocabulary:

- `draft-only-email` blocks the `send` class, and blocks `gmail.users.settings.filters.create` when the filter body as built carries a forward address. Drafts, replies and forwards saved as drafts are allowed.
- `read-only` blocks every method not classified as a read.
- `no-delete` and `audit` keep their current meaning.

Presets named in the environment and in the file all apply, and any block wins, so the environment can only tighten the file. `account-access` (ADR-202) stays always on.

### 6. Account widening is a policy rule

`manage_accounts` `authenticate` and `scopes` requests for `access: readwrite` never reach the Google client, so they get their own rule (`accounts.widen: allow | block`). The default allows them, matching today.

### Default template (shape, not final syntax)

```yaml
# google-workspace-mcp safety policy. Delete this file to regenerate the default.
version: 1
presets: []                 # draft-only-email, no-delete, read-only, audit
methods: {}                 # "service.method glob" or class (send, reach, write): allow | block
unclassified: allow         # block: writes no rule names fail closed
accounts:
  widen: allow              # block: refuse authenticate/scopes asking for readwrite
```

## Consequences

### Positive

- A new operation, handler or scratchpad target is covered on day one, because enforcement sees the Google method it ends up calling.
- `draft-only-email` no longer depends on handlers and the policy agreeing about `params.draft`: the client sees whether the request is `drafts.create` or `messages.send`.
- No session under `draft-only-email` can send, whatever an earlier session staged. A staged draft reaches its recipient only through a person.
- Drive sharing and calendar invitations, which no policy covers today, can be blocked with one method rule or the `reach` class.
- Operators get one validated, commented file in the place they already find `accounts.json`, and a broken file stops the server instead of weakening it.

### Negative

- Rules cannot allow sending to some addresses and not others. A deployment that wants "send only within my domain" has no way to say it.
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
- **Recipient allowlists checked on resolved addresses.** Every send, draft, share and invitation would be checked against address globs, resolved from the request as built (To, Cc and Bcc of the outgoing message, a stored draft's headers, Drive grantees, calendar attendees). Deferred: method blocking already closes the agent's path to sending, recipient checks on drafts would second-guess the person reviewing them, and the extraction is the most complex part of the design. It is reconsidered when a deployment needs to allow sending to some addresses and not others.
- **Track intent across sessions** (taint drafts or messages the agent created and refuse to send them later). The connecting state lives in Google, any session boundary loses it, and a person clicking Send is outside it.
- **Protect the configuration from the host agent** (file permissions, hash pinning, refusing to start when the file is writable). Rejected: the host that offers the server to an agent owns that boundary, and the server cannot enforce it against a process with the same user's shell.
- **Make the default conservative now.** Deferred. Today's default is permissive, and changing it breaks existing deployments; the template makes a later change a one-file decision.

## Revision note, 2026-10-27

The first proposal checked every send, draft, share and invitation against a recipient allowlist resolved from the request. The operator's answers to its probes were recorded (`considered`, covering `draft-refusal` and `draft-default`), and on reflection the operator judged recipient checking too complex for a policy layer. Recipient allowlists moved to Alternatives Considered as deferred, and enforcement is by Google method with one body check for forwarding filters.
