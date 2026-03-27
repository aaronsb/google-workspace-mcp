---
description: Offering both readable and lossless modes when there's a fidelity trade-off
vocabulary: markdown json fidelity lossy lossless readable opaque mode format import export csv rich text plain
pattern: import|export|format.*mode|markdown.*json|fidelity
files: src/services/|src/server/
---
# Dual Modes at Fidelity Boundaries

When a content format has a genuine trade-off between human readability and structural fidelity, don't force one choice. Offer both modes and let the agent or user pick based on the task.

**The pattern:**

| Mode | Properties | When to use |
|------|-----------|-------------|
| Readable (markdown, CSV, plain text) | Lossy but editable, inspectable, cross-service portable | Rewriting, extracting, composing, human review |
| Lossless (JSON, native API structures) | Full fidelity but opaque, harder to navigate | Targeted edits preserving formatting, round-trip mutations |

**Where this applies in GWS:**

- Google Docs: markdown export vs Docs API JSON
- Google Sheets: CSV lines vs Sheets API JSON
- Email: plain text body vs MIME structure
- Drive files: text extraction vs native format

**When adding a new import/export path**, check whether both modes are feasible. If the lossy mode drops information the agent might need, the lossless mode should exist too — even if it's added later.
