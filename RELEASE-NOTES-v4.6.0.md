# v4.6.0

## Clean up drafts, make your own labels

Both features in this release came from contributors. Thank you to **@yabdi** (#194) and **@srahaman1** (#195), who is contributing for the first time.

### 🗑️ List and delete drafts

`manage_email` can now see and discard drafts. Until now there was no way to delete one: `trash` addresses messages, and a draft is its own Gmail resource with its own id.

```
manage_email { operation: 'listDrafts', email: 'you@example.com' }
manage_email { operation: 'deleteDraft', email: 'you@example.com', draftId: 'r2465784785066018840' }
```

`listDrafts` shows each draft's id with its recipient, subject and date, so the right id is on the row you're reading. A message id from `search in:drafts` will not work for deletion; Google rejects it as not found.

Deleting a draft is **permanent**. Gmail has no trash for drafts. For that reason `deleteDraft` is blocked under `GWS_SAFETY_POLICY=no-delete`, alongside the other permanent deletes.

### 🏷️ Create labels

`manage_email createLabel` makes a Gmail label, so an agent can set up the labels it then applies with `modify` without anyone opening the Gmail UI first. A slash nests it:

```
manage_email { operation: 'createLabel', email: 'you@example.com', name: 'REC/Receipt' }
```

The returned label id is what `modify` takes. Gmail refuses a name that already exists, so check `labels` first. Read-only accounts are refused before the request leaves.

Neither feature asks for a new scope; the existing `gmail.modify` consent covers both.

### Also

- **`docs/api-surface.md` is current.** It now shows the three new Gmail methods (13 of 79 exposed) and Google's own changes since the last refresh: six new Meet `spaces.members` methods and three new Chat methods.
