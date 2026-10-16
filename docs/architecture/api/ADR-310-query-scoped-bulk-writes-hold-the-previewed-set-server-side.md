---
status: Draft
date: 2026-10-16
deciders:
  - aaronsb
related:
  - ADR-309
  - ADR-308
  - ADR-301
---

# ADR-310: Query-scoped bulk writes hold the previewed set server-side

## Context

Some bulk writes are defined by a query rather than by a list the caller already has: "archive everything from this sender", "mark every match read". The caller knows the query, the count and the change; it never needs the individual ids. Where the API takes only ids, as Gmail's `batchModify` does, something has to turn the query into ids.

Today that something is the caller. It pages the ids into the conversation and then copies every one of them back out into the write. The cost grows with the size of the set rather than staying fixed, and a model copying hundreds of opaque ids is a likely place for a dropped or altered one. Issue #206 measured the case: 955 messages, about 16k characters of ids in each direction, when the only facts in play were a query, a count and two label changes.

Moving the resolution to the server removes the ids from the conversation, and with them the caller's only view of what will change. ADR-309 already answers "a write whose scale the caller cannot see": preview the exact change, show its scale, and require a token from that preview. A query-scoped write has the same problem with one difference. A filter's effect is fixed by its definition. A query's matches move between preview and apply, as mail arrives and as people file things by hand.

The server already holds per-user state that a later call refers to by id. The scratchpad (ADR-301) keeps content buffers between calls, drops them after a period of inactivity, and refuses to sync a document that changed since it was imported. That is the same promise this decision needs: what was looked at is what is changed.

## Decision

**Reversibility: reversible.** The store is in memory and the token format is internal; neither persists.

### 1. Preview resolves the query and holds the set

A query-scoped bulk write is a preview and an apply, gated as ADR-309 §1 and §2 describe: a token bound to the account, the payload and the time, refused when minted in the same tool call.

The preview walks every page of the query, never an estimate, and stores the resulting ids server-side under a preview id. It returns the exact count, a sample of matches, the plain-language effect of each change in ADR-309's terms, and the token. No id beyond the sample enters the conversation.

### 2. Apply changes exactly the stored set

Apply takes the same parameters and the token, loads the stored set, and changes those messages and no others, in chunks at the API's limit. Mail that matches the query only after the preview is untouched; routing future mail is a filter's job (ADR-309). Apply reports how many messages it changed and any chunk that failed, never the ids.

The token covers a digest of the stored set as well as the query and the changes. If the set is gone (expired, evicted, or lost to a restart) or does not hash to what was previewed, apply refuses and asks for a fresh preview.

A stored set is used once. Apply removes it from the store whether it succeeds or fails part-way, and a failure reports how far it got. Retrying is a new preview, which resolves the query again against the mailbox as it now is.

### 3. The store is bounded

- **Per set:** a cap on ids per preview, well above a realistic backlog and small enough to hold in memory. A preview over the cap reports the count, withholds the token, and asks for a narrower query, such as a date range.
- **In time:** a set lives no longer than its token, ADR-309's 30 minutes.
- **In number:** a cap on pending previews per process; the oldest is evicted first.

### 4. A preview says when a change is a bulk disposal

Adding `TRASH` through this path trashes every message in the set. The preview says so in those words, with Gmail's 30-day deletion of trash, as ADR-309 does for a filter that trashes.

### Applying this to Gmail

- Operations on `manage_email`: `previewModifyMatching` (a read over `users.messages.list`) and `modifyMatching` (`users.messages.batchModify`, in chunks of 1,000). Parameters: `query`, `addLabelIds`, `removeLabelIds`, `previewToken`.
- Both need only `gmail.modify`, which accounts already hold. A read-only account can preview and is refused the apply under ADR-202.
- `previewFilter`'s note about existing matches names `previewModifyMatching` with the filter's own query and changes, so a filter and its backlog become two previews and two applies with no ids in between.
- `search` with `idsOnly` and `bulk_operations` batch `modify` stay for callers that have, or want, the ids themselves.

## Consequences

### Positive

- The cost of a query-scoped write is fixed: a query, a count and the changes, whatever the size of the set.
- What changes is exactly what was counted and sampled, so the preview describes the write rather than an approximation of it.
- The ADR-309 gate is reused unchanged; only the payload grows a digest and a preview id.

### Negative

- The server holds up to the per-set cap of ids per pending preview, until applied or expired.
- A restart between preview and apply loses the set, and the remedy is a new preview.
- A message that left the set's natural scope between preview and apply, for example one filed by hand, is still changed, because it was in the previewed set. The preview's age is bounded at 30 minutes to keep this small.

### Neutral

- The pattern applies to any API that writes by id where callers think in queries. Gmail is the first case; others would reuse the store and the gate.

## Alternatives Considered

- **Resolve the query again at apply, refusing when the count drifts** (#206's option b). Stateless, but on the busiest senders, the case this exists for, the count drifts between preview and apply, so the refusal lands exactly where the operation is needed. With a tolerance instead of a refusal, apply changes a set nobody previewed.
- **Keep ids with the caller** (today's path). Correct and still available, but the cost scales with the set and every id is copied by a model.
- **Encode the id set in the token.** Stateless and exact, but the token then carries the ids through the conversation, which is the cost this decision removes.
- **Persist the store to disk.** It would survive a restart, but tokens do not survive one (ADR-309 §2), so a persisted set would be unreachable anyway.
- **No preview; apply straight from the query.** The fewest calls, and a write over a set nobody has seen the size of, which ADR-309 rules out.

## Notes

Motivated by #206, which followed #202 and #203 through a real backlog cleanup on v4.7.0.
