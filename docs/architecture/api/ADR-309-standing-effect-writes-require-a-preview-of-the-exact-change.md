---
status: Accepted
date: 2026-10-16
deciders:
  - aaronsb
related:
  - ADR-202
  - ADR-300
  - ADR-308
---

# ADR-309: Standing-effect writes require a preview of the exact change

## Context

Most writes this server exposes act once, on things the caller has already seen: send this message, label these ids, delete this event. A small class of writes keeps acting after the call returns, on things the call never saw. A Gmail filter applies its action to every future message that matches its criteria. A forwarding rule or an auto-reply behaves the same way. Call these **standing-effect writes**.

A standing-effect write cannot be checked by looking at its result, because the result arrives later, one matching message at a time. The only point where the caller can see what it will do is before it exists, by evaluating its criteria against the mail already there. Issue #202 asks for Gmail filters. The case behind it is a transactional sender producing dozens of messages a day, which the agent can already search for and clean up, but cannot stop at arrival.

Two weaker designs were on the table: create with advisory warnings, or create with the risky actions (`forward`, the `TRASH` label) removed from the schema. ADR-202 already records why the first is weak: `confirmWriteAccess` can be sent on the first call, because nothing server-side remembers having warned. The second refuses without explaining, and it also refuses legitimate uses.

An evaluation is only as good as its count. Issue #203 shows that `search` caps at 50 results and drops `nextPageToken`, so a full page of 50 looks the same as a complete result of 50. A preview that says "matches 50 messages" when 400 exist is the same defect as the one being guarded against: a change whose scale the caller cannot see.

## Decision

**Reversibility: reversible.** The gate is a server-side check with an internal token format, and neither touches stored data.

### 1. A standing-effect write is two operations: `preview` and `create`

`preview` is a read. It takes the full payload `create` would take and returns:

- the object as Google would store it;
- its scale against existing data: the matching count, labeled exact or estimated (see 3), and a sample of matches;
- conflicts with existing objects: an identical or overlapping filter already present;
- the consequence of each action in plain language, for example "TRASH: matching mail goes to trash on arrival and is deleted after 30 days" or "forward: future matches go to bob@example.com with no further prompt";
- a **preview token**.

`create` requires that token and refuses without it. A refusal states what is missing and the call that produces it, in the form ADR-202 uses for blocked writes.

Changing an existing object is gated the same way. `preview` names the object a change would replace, shows it beside the replacement, and mints a token only `update` accepts.

The schema keeps every action Google supports. The preview is what explains a dangerous action, and the gate makes sure that explanation is returned before the write happens.

`preview` is typed `list`, so a read-only account can run it under ADR-202, and an agent can evaluate a filter for an account that cannot create one.

Problems that would make the write fail or do nothing, such as a label that does not exist or an exact duplicate, are reported as errors and withhold the token. Consequences are shown, never refused.

### 2. The token binds the exact payload, the account, and a time

The token is an HMAC, under a key generated at process start, over the canonical serialization of `{account, payload, issuedAt}`. `create` recomputes the HMAC from the payload it receives. It refuses when:

- **the payload differs** from what was previewed, so editing the filter after preview means previewing again. For an update the payload includes the object being replaced as it was at preview time, so an object that changed since is not replaced on the strength of a preview of something else;
- **the token was minted for another operation**, such as an update token offered to `create`;
- **the token has expired** (30 minutes), because the count and the conflict check drift as mail arrives and filters change;
- **the token was minted within the same top-level tool call**, which closes the path where a `bulk_operations` queue chains `preview` into `create` via `$0.previewToken` and no result reaches the caller in between.

`create` reruns the conflict check at write time, because a filter may have been added between preview and create.

A token proves that the evaluation was returned to the caller. It does not prove that a person read it. Human approval remains the MCP client's job, through its per-call permission prompt. The gate ensures that what the person approves is a call carrying an evaluation they could have seen.

The stateless HMAC design leaves nothing to store or expire. A server restart invalidates every outstanding token, and the remedy is to preview again.

### 3. A list that stops before the end says so

This is required for the preview's count to be honest, and it applies to every list operation:

- the response reports when more results exist and carries `nextPageToken`, with the "call again with pageToken" footer already used by contacts and Meet transcripts;
- the operation accepts `pageToken`;
- a count Google provides as an estimate (`resultSizeEstimate`) is labeled as an estimate;
- where hydrating each row costs a call (Gmail `search` fetches `messages.get` per row), an **ids-only** mode skips hydration and pages at the API's limit (500 for `messages.list`). Its output is shaped to feed `bulk_operations` batch mode (ADR-308) directly.

The preview counts by walking ids-only pages up to a cap. When the walk ends under the cap, the count is exact. Otherwise it reports "at least <cap>; Google estimates <n>".

Gmail's lists meet this with this record. The list operations of other services that Google pages are tracked in #204.

### 4. The full lifecycle: read, preview, create, update, delete

Reads (`list`, `get`) need no gate. `get` returns the object with the parameters that recreate or edit it.

`delete` needs no preview: it stops future actions and does not act on anything itself. It returns the full definition of what it removed, so the object can be recreated through `preview` and `create`.

Where Google has no update method (Gmail filters have none), `update` is a gated replace. It creates the replacement first and deletes the original after, so a failure part-way leaves two objects and says so, never none. The replacement gets a new id, and the operation description says so.

### Applying this to Gmail filters

- Operations on `manage_email`: `filters`, `getFilter`, `previewFilter`, `createFilter`, `updateFilter`, `deleteFilter`. Criteria are flat `match*` parameters; actions are `addLabelIds`, `removeLabelIds` and `forwardTo`.
- The preview translates each `Filter.criteria` field into Gmail search syntax: `from:`, `to:`, `subject:`, the free `query`, `negatedQuery` as `-(…)`, `has:attachment`, `larger:` and `smaller:` from size, `-in:chats`. Every field has an exact translation, so the count describes the filter being created.
- Label ids are checked against the account's labels. A label name passed where an id belongs is an error that gives the id.
- A preview evaluates past mail as a proxy for future mail and says so.
- `forward` is checked against the account's verified forwarding addresses, so an address Gmail will reject fails at preview rather than at create.
- Under the `draft-only-email` safety policy, a filter that forwards is blocked: it would send every future match.
- Scope: `gmail.settings.basic` joins `SERVICE_SCOPE_MAP.gmail`. `create` and `delete` accept only that scope. `list`, `get` and `preview` are covered by the `gmail.modify` and `gmail.readonly` scopes accounts already hold. The read-only map does not change.

## Consequences

### Positive

- A standing-effect write cannot reach Google without an evaluation of that exact write being returned first.
- Dangerous actions stay available, and each carries its explanation at the moment it matters.
- The truncation fix applies to every list operation, not just the preview: an agent sizing a cleanup can see the whole result and act on it through `bulk_operations` batch mode.
- `preview` is useful on its own, for example to explain why a message was routed where it was, or to evaluate a filter for a read-only account.

### Negative

- Creating a filter takes at least two calls, and the token has to be carried between them.
- The token proves the evaluation was returned, not that it was read. A caller that discards the preview passes the gate.
- The same-call check needs a top-level invocation id that `PatchContext` does not carry today. It has to be threaded through `bulk_operations` queue and batch execution.
- Existing accounts lack `gmail.settings.basic` and must re-consent before `create`, `update` or `delete` works. The ADR-202 block message names the missing scope, since such an account holds write access and is not read-only.
- A restart between preview and create costs a second preview.

### Neutral

- Gmail caps filters at 1,000 per user. The preview reports the current count when it is near the cap.
- The definition of standing effect decides future scope. A later operation joins this gate when its effect keeps acting, after the call, on things the call never saw: a forwarding rule, an auto-reply. Changing a Drive permission does not qualify, because it acts once on a known set.

## Alternatives Considered

- **Create with advisory warnings.** Rejected: the warning can be skipped, and ADR-202's `confirmWriteAccess` already shows that an unremembered warning is not a gate.
- **Remove risky actions from the schema** (`forward`, `TRASH` in `addLabelIds`). Rejected: the agent gets a refusal with no reason and the person is left guessing why. It also blocks legitimate uses, such as forwarding a vendor's invoices to an accounts-payable address. The preview explains instead of hiding.
- **A `dryRun` flag on `create`.** Rejected: if it defaults to false, the ungated path is the default; if it defaults to true, `create` does not create. A separate operation also types correctly under ADR-202, a read the manifest calls a read.
- **A server-side registry of previews** (preview id → stored payload). Workable. Rejected in favor of the HMAC, which binds the payload intrinsically and leaves nothing to expire or clean up. Both lose state on restart.
- **In-band human confirmation via MCP elicitation.** Stronger, since it would prove a person saw the preview, but client support varies. It can be layered on top of the token later without changing it.

## Notes

Motivated by #202 (Gmail filters) and #203 (search paging and counts), which describe the same case from opposite ends: a filter stops new mail, and paging clears what arrived before the filter existed.
