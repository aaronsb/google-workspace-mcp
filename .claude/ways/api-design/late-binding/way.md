---
description: Decoupling composition from delivery, late-bound targets, deferred binding
vocabulary: bind target send deliver compose buffer scratchpad decouple recipient dispatch late early creation
pattern: send|target|deliver|bind|scratchpad
files: src/services/|src/server/
---
# Late-Bound Targets

In this project, content composition and content delivery are separate concerns. When designing operations that create content and then deliver it somewhere:

- **Bind the target at send time, not at creation time.** A piece of content should not know where it's going until the agent explicitly delivers it.
- **Why:** Retry resilience (failed sends don't lose content), multi-recipient delivery (same content to N targets), cross-service reuse (email content becomes a doc), and simpler agent logic (compose first, decide destination later).
- **The anti-pattern:** Requiring a destination when the buffer/draft is created. This couples the lifecycle of the content to a single delivery path. If that path fails or changes, the content is stranded.

This applies to the scratchpad (ADR-301) and to any future primitive that holds agent-authored content before delivery.
