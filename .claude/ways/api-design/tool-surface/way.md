---
description: Tool response design, what agents see, hiding plumbing, binary references, clean output
vocabulary: tool response format output agent surface visible opaque plumbing implementation detail binary base64 reference marker attachment blob
pattern: tool.*response|format.*output|patch\.ts|formatter
files: src/services/.*patch\.ts|src/factory/
---
# Tool Surface Design

Tool responses are the agent's entire view of what happened. Two principles govern what goes into them:

## Hide the plumbing

The agent doesn't need to know *how* data reaches the API — whether it's a live JSON sync, a queued batch, or a direct CLI call. The tool interface should look the same regardless of the backend path. When writing patch formatters or custom handlers:

- Return the same shape whether the operation was synchronous or queued.
- Don't expose internal state (buffer IDs, sync status, retry counts) unless the agent needs to act on it.
- If the backend changes, the tool response shouldn't.

## Keep binary out of agent-visible content

Base64-encoded images, file blobs, and other uneditable binary data never belong in text the agent will read or edit. Instead:

- Use **reference markers** in text content (e.g., `att:att-1` in the scratchpad, file references in responses).
- Store the actual binary in the workspace or attachment side-table.
- The agent can move, copy, or remove markers — it never needs to parse or re-encode binary content.

This applies to scratchpad buffers, tool response text, and any formatted output the agent consumes.
