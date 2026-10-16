# v4.8.0

## Change everything a search matches, without the ids

### 🧹 `previewModifyMatching` and `modifyMatching`

Archiving, labeling or marking read everything a query matches used to mean collecting every message id with `search` and handing them all back to `bulk_operations`. For a 955-message backlog that was about 16k characters of ids in each direction, copied by the model one by one (#206). The server now resolves the query itself:

```
manage_email { operation: 'previewModifyMatching', email: 'you@example.com', query: 'from:billing@vendor.com', addLabelIds: 'Label_7', removeLabelIds: 'INBOX' }
manage_email { operation: 'modifyMatching',        email: 'you@example.com', query: 'from:billing@vendor.com', addLabelIds: 'Label_7', removeLabelIds: 'INBOX', previewToken: '…' }
```

The preview walks every page of the query and returns the exact count, a sample of five, what the change does to each message, and a `previewToken`. The apply changes exactly the messages the preview counted, in batches of 1,000, and reports how many it changed. Mail that starts matching after the preview is left alone; routing future mail is what a filter is for.

The same gate as filters applies (ADR-309, ADR-310): the token is good for 30 minutes, for one account and exactly the previewed query and change, and only in a later call than the preview. Each preview applies once. A preview holds up to 10,000 messages; a larger backlog is previewed in parts, for example by date range. Adding `TRASH` this way is described as a bulk trash.

`previewFilter` now points at these operations for the mail a new filter's criteria already match, so a filter and its backlog become two previews and two applies.

No re-consent is needed: both operations use the `gmail.modify` scope accounts already hold.
