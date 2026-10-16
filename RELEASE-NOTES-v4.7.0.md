# v4.7.0

## Gmail filters, and searches that say how big they are

### 🧭 Manage Gmail filters, behind a preview

`manage_email` can now list, read, create, change and delete Gmail filters, so mail can be routed when it arrives instead of cleaned up afterwards (#202).

```
manage_email { operation: 'previewFilter', email: 'you@example.com', matchFrom: 'billing@vendor.com', addLabelIds: 'Label_7', removeLabelIds: 'INBOX' }
manage_email { operation: 'createFilter',  email: 'you@example.com', matchFrom: 'billing@vendor.com', addLabelIds: 'Label_7', removeLabelIds: 'INBOX', previewToken: '…' }
```

A filter acts on mail that has not arrived yet, so creating or changing one requires a preview of that exact change first (ADR-309). `previewFilter` reports how many messages the filter matches today with a sample, says what each action will do, flags duplicate and overlapping filters, and returns a `previewToken`. `createFilter` and `updateFilter` refuse without one. A token is good for 30 minutes, for one account and exactly the previewed parameters, and only in a later call than the preview.

Every action Gmail supports is available. Trashing and forwarding are explained in the preview rather than refused. An unknown label, a label name passed where an id belongs, an unverified forwarding address, or an exact duplicate withholds the token.

Gmail has no in-place update, so `updateFilter` creates the replacement and then deletes the original; the filter gets a new id. `deleteFilter` returns the parameters that put the filter back. Under the `draft-only-email` safety policy, a filter that forwards is blocked.

**Existing accounts need to re-consent before creating, changing or deleting filters.** Google accepts only the `gmail.settings.basic` scope for those, and accounts authorized before this release do not hold it. Listing, reading and previewing filters work without it. To grant it, run `manage_accounts { operation: 'scopes', email: '…', services: '…' }` with the services the account already has; the refusal message names the call.

### 📏 Search says when there is more

`search`, `triage`, `threads` and `listDrafts` used to stop at one page with nothing to say more existed, so 50 results of 50 looked the same as 50 of 400 (#203). They now report when more results exist, give Google's total labeled as the estimate it is, and accept `pageToken` to continue.

`search` with `idsOnly: true` returns up to 500 message ids per page without fetching each message, ready to pass to `bulk_operations` batch `modify`. A filter preview uses the same path to count matches.
