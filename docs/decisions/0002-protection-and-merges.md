# 0002 — Main protection and merge authority

Status: live server snapshot on 16 November 2026 after concurrent activation at 02:33 UTC and extension at 02:45 UTC; supersedes earlier dormant-rule/unrestricted-bypass descriptions.

All three rulesets are active. Default-branch signatures/history are protected. History/signature rules have no bypass actors. The Maintainer/Admin review exception is PR-only, so those roles can merge their own PRs without a separate approving reviewer; all 14 required checks and strict current-base verification still apply. The required-check ruleset has no human bypass.

Maintenance App `5776881` has explicit `always` bypass on the active review/check rules. Registration, protected promotion proof and source delivery belong to separate ongoing work; this documentation readback does not independently certify the complete promotion path on main. Source JSON mirrors the live rules without changing server settings.

Consequences: wait for current complete checks, preserve independent release gates and document effective settings separately from historical policy. [GitHub administration](../GITHUB_WORKFLOW.md) holds exact IDs, sources, readback commands and boundaries.
