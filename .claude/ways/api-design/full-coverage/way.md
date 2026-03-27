---
description: Cross-cutting features should cover all services, not a subset
vocabulary: cross-cutting coverage services partial complete scope horizontal all seven email docs drive sheets calendar tasks meet scratchpad
pattern: cross.cutting|all.*service|coverage|scratchpad.*service
files: src/services/|src/factory/manifest\.yaml
---
# Full Coverage for Cross-Cutting Features

When a capability spans multiple GWS services — the scratchpad, batch operations, account management, or anything horizontal — commit to covering all supported services. Partial coverage creates confusion about when the feature applies and when to fall back to direct operations.

- **At design time:** Map the feature to every service. Some mappings may be trivial (calendar events are text, no special adapter needed). Document which services are covered and which are deferred with a reason.
- **At implementation time:** It's fine to ship incrementally — email and docs first, then sheets, then the rest. But the design should account for all services from the start so later additions don't require rearchitecting.
- **The anti-pattern:** Building a feature for 2-3 services and calling it done. Agents can't predict which services support the feature and which don't — they'll try it everywhere and hit confusing errors on uncovered services.
