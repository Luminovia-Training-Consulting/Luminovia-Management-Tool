# 0002 — Main protection and merge authority

Status: existing policy, verified again on 16 November 2026.

The default branch has active signature/history protection. Repository Maintainer and Administrator roles have `always` bypass, satisfying the user's requirement to retain direct merge authority. Ordinary Write access does not gain that exception.

Additional independent-review and required-check rules are prepared but disabled until the separate repository-scoped maintenance App path proves it can promote signed tested source under protection. Enabling those rules before that proof would break the current automated maintenance workflow. No extra account, App or broad token is introduced by the documentation increment.

Consequences: explain effective settings separately from the contributor process; preserve successful full-CI requirements for automatic development releases even when a human merges early. [GitHub administration](../GITHUB_WORKFLOW.md) holds exact IDs, sources, readback commands and next actions.
