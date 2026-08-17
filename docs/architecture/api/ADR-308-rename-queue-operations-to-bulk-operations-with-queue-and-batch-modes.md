---
status: Proposed
date: 2026-08-17
deciders:
  - aaronsb
related:
  - ADR-103
  - ADR-300
---

# ADR-308: Rename queue_operations to bulk_operations, with queue and batch modes

## Context

`queue_operations` runs several tool calls in sequence, threading results between them with
`$N.field` references. It is named after its **strategy** rather than its **purpose**: a
queue is one way to do many things, and the tool exists to do many things.

That naming stopped being cosmetic once the second strategy turned out to be available.
Google publishes methods that perform one operation across many resources in a single HTTP
request. Doing 200 contact deletions through the queue costs 200 round trips; Google offers
to do it in one.

### What Google actually publishes

Measured across all eight services in `descriptor.json`. Every method with `batch` in its
name falls into one of two groups, and only the second is a bulk *mode*:

**Many edits to ONE resource** — a second axis, and not the one this ADR builds:

| Service | Method |
|---|---|
| docs | `documents.batchUpdate` |
| sheets | `spreadsheets.batchUpdate`, `values.batchUpdate`, `values.batchClear`, `values.batchGet` (+ `ByDataFilter` variants) |

An earlier draft of this ADR said these operations "already work this way". **They do not.**
`manage_docs` and `manage_sheets` do call `batchUpdate`, but each tool call sends
`requests: [ …exactly one request… ]` (`src/services/docs/patch.ts`,
`src/services/sheets/patch.ts`). Google's `batchUpdate` accepts an array, so five edits to
one document currently cost five HTTP calls carrying one request each, where they could
cost one carrying five.

That is a real, unused capability on a different axis, and the call shape designed below
would serve it unchanged — the shared `documentId` at the top level, the individual edits
as `items`. It is not built here, and the refusal message deliberately does not claim
"Google publishes no batch method", because for docs and sheets that would be false.
Tracked separately.

**One operation across MANY resources** — the real bulk surface:

| Service | Method | Verb |
|---|---|---|
| gmail | `users.messages.batchModify` | POST |
| gmail | `users.messages.batchDelete` | POST |
| people | `people.batchCreateContacts` | POST |
| people | `people.batchUpdateContacts` | POST |
| people | `people.batchDeleteContacts` | POST |
| people | `people.getBatchGet` | GET |

Six methods, two services. **All six are coverage gaps** — none appears in any manifest.
`calendar`, `docs`, `drive`, `meet` and `tasks` publish no such method at all, so for those
services a queue is not a fallback, it is the only thing there is.

**Five of the six are batchable here. `users.messages.batchDelete` is not**, and the reason
is a scope rather than an omission:

```
users.messages.trash        ["https://mail.google.com/", ".../gmail.modify"]
users.messages.batchDelete  ["https://mail.google.com/"]
users.messages.delete       ["https://mail.google.com/"]
```

Gmail's delete is immediate and permanent — it does not route through the trash, which is
why `trash` accepts `gmail.modify` and delete accepts only `https://mail.google.com/`, the
broadest scope Gmail publishes. This server requests `gmail.modify` and nothing wider, and
`manage_email` deliberately exposes no permanent delete at all (`safety.ts` records
`gmail: []` in `permanentDeletes` with the note that trash is reversible).

Batching it would therefore mean widening every Gmail account to full mailbox authority
and re-consenting all of them, to gain an operation whose only advantage over `trash` is
irreversibility. The capability is not really lost: `batchModify` with
`addLabelIds: ['TRASH']` trashes many messages in one request, reversibly, on the scope
already held.

Noted while measuring this, and worth fixing on its own: the call-time access policy models
two cases — narrowed to read-only, and never authorized — but not a third, *this operation
requires a scope the server never requests*. An operation like `users.messages.delete`
would be refused with "was authorized read-only for gmail" to an account holding full
`gmail.modify`, which is simply false. No operation in any manifest currently requires an
unrequested scope, so the case is unreachable today; a guard belongs with the policy.

An earlier count of this surface said five methods and missed `people.getBatchGet`, which
is a batch *read*. It also included `sheets.values.batchGet`, which belongs to the first
group — many ranges within one spreadsheet. Both errors came from reading method names
rather than what the methods address.

## Decision

Rename the tool to `bulk_operations` and give it a `mode` naming the strategy.

```
bulk_operations { mode: 'queue' | 'batch', ... }
```

`mode` defaults to `'queue'`, so every existing call behaves exactly as it does today.

### queue — N operations, N calls, in order

Unchanged. An `operations` array of `{tool, args}`, executed in sequence, with `$N.field`
references threading a result into a later argument, `onError` of `bail` or `continue`, and
nesting up to `MAX_QUEUE_DEPTH`. This is the general mechanism: it works for any tool, any
operation, any mix.

### batch — one call across many resources

```
bulk_operations {
  mode: 'batch',
  tool: 'manage_contacts',
  operation: 'delete',
  items: [ {contactId: 'people/c1'}, {contactId: 'people/c2'} ]
}
```

One tool, one operation, many items, one HTTP request. Deliberately *not* the queue's
`operations` array: a batch is a single call and cannot thread `$N` references between its
items, so borrowing a shape that implies ordering and chaining would advertise semantics
the mode does not have.

Asking to batch something Google cannot batch fails with the list of what can:

```
manage_calendar 'delete' cannot be batched — Google publishes no batch method for it.
Operations that can: manage_email modify, manage_email trash,
manage_contacts create, manage_contacts update, manage_contacts delete, manage_contacts get.
Use mode:'queue' instead, which works for every operation.
```

### Capability is declared in the manifest and checked against the descriptor

An operation opts in by naming the Google method that batches it:

```yaml
delete:
  type: action
  resource: people.deleteContact
  batch:
    resource: people.batchDeleteContacts
```

The batch method is not always the same method pluralised. Gmail has no bulk trash; the
way to trash many messages is `batchModify` adding the `TRASH` label. The agent should not
have to know that, so the manifest carries the translation and `defaults` supplies the
fixed part of the body — the same mechanism that keeps field masks and source constants
out of the schema (ADR-300):

```yaml
trash:
  type: action
  resource: users.messages.trash
  batch:
    resource: users.messages.batchModify
    defaults:
      addLabelIds: ['TRASH']
```

`bulk_operations {mode:'batch', tool:'manage_email', operation:'trash', items:[…]}` then
trashes many messages in one request, reversibly, and the caller never sees a label.

A test asserts every batch `resource` resolves in `descriptor.json`, the same way
`resource` is checked. The list of batchable operations is *derived* from the manifest at
startup, never hand-written.

This matters because this repository has now produced the same defect three times: a
hand-maintained list beside a generated one, drifting silently. `queue_operations`' own tool
enum was hardcoded and omitted `manage_contacts` for an entire release; `coverage-baseline.json`
sat a month stale, missing a whole service; and #161 was a hand-kept description diverging
from what the model was told. A hardcoded list of batchable operations would be the fourth.

### The old name keeps working for one minor release

`queue_operations` stays registered as an alias, dispatching to the same handler, and its
description says it is renamed. MCP client configurations and agent habits both reference
it, and a tool that vanishes gives a caller no way to discover what replaced it.

## Consequences

### Positive

- 200 contact deletions become one request instead of 200.
- Six coverage gaps close, in the two services that publish batch methods.
- The tool is named for what it does rather than for one of its two strategies.
- `batch` failing loudly, with the batchable list, teaches the surface at the point of use.

### Negative

- A public tool is renamed. Every rename costs its callers something even with an alias,
  and the alias has to be removed eventually.
- Two modes with different input shapes in one tool. The alternative — one shape — was
  rejected below, but the cost is real: a caller must read which fields go with which mode.
- Per-item error reporting differs by method. `batchDelete` returns 204 with no body, so a
  partial failure is not distinguishable per item; `batchCreateContacts` returns a result
  per contact. The tool cannot present one uniform result shape without inventing detail
  Google did not send.

### Neutral

- `batch` is narrow and will stay narrow. It covers what Google publishes, which is two
  services. That is a property of Google's API surface, not of this design.
- `people.batchUpdateContacts` requires each contact's current `etag`, exactly as the
  single-contact `update` does. It can be satisfied with one `getBatchGet` followed by one
  `batchUpdateContacts` — two calls for N contacts, still far better than N — but it is
  the most involved of the six and lands in the second increment.

## Alternatives Considered

- **Keep the name `queue_operations` and add `mode`.** Rejected: it names the tool after
  one of the two things it does, and the confusion compounds as soon as `mode: 'batch'`
  exists inside something called a queue.
- **Coalesce automatically** — keep the single `operations` array and merge consecutive
  entries sharing a tool and operation into one batch call. Attractive because it keeps one
  input shape and needs no new parameter. Rejected: it makes the number of HTTP requests a
  silent function of argument order, so reordering a list changes cost and error reporting
  with nothing in the call to say so. The caller should be able to see, in the call they
  wrote, whether they asked for one request or two hundred.
- **A separate `batch_operations` tool.** Rejected: two tools whose descriptions differ in
  one clause is exactly the surface the agent has to disambiguate on every use, and
  `tools/list` is served once per server, so both would always be advertised.
- **Expose the batch methods as ordinary operations** — `manage_contacts batchDelete`.
  Rejected: it spreads bulk semantics across every service's schema, and repeats the
  `items` parameter in each. The generator flattens all operations into one schema per
  service and keeps only the first declaration of a repeated parameter name, so per-service
  `items` parameters would have to be described identically forever (the #161 shape).
- **Ship the rename without batch.** Rejected as a release: a rename that adds no
  capability spends the callers' migration cost and returns nothing for it.

## Notes

Delivered in two increments so each is reviewable, split so that nothing advertised is
inert:

1. **The rename alone** — `bulk_operations`, with `queue_operations` kept as an alias.
   No behaviour change, no new parameter.
2. **`mode` and batch** — the `mode` parameter, `batch_resource` in the manifest with its
   descriptor check, batch execution, and the six methods.

`mode` belongs to the second increment rather than the first. Shipping a `mode: 'batch'`
the tool cannot execute would advertise a capability in `tools/list` — served once per
server, to every caller — that answers with an apology. An agent has no way to tell an
advertised-but-unimplemented option from a broken one.

Both increments land before the release that carries the rename.

Batch size limits are documented by Google as 200 for `batchUpdateContacts` and
`batchCreateContacts`, 500 for `batchDeleteContacts`, and 1000 ids for the Gmail methods.
These are to be **verified against live Google** before being enforced, not transcribed —
this repository has twice found a documented value to be wrong on the wire.
