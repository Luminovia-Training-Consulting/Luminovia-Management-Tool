# 0002 — Main protection and merge authority

Status: live server readback on 16 November 2026; supersedes earlier disabled-rule, unrestricted-human-bypass and maintenance-App-exception snapshots.

All three rulesets are active. Default-branch signatures, deletion and force-push restrictions have no bypass actors. The Maintainer/Admin review exception is PR-only, so these roles may merge their own PRs without a separate approving reviewer. All **15 required checks** and strict current-base verification still apply to every identity. Fourteen check contexts are bound to GitHub Actions integration `15368`; the generated `CodeQL` findings result is bound to integration `57789`.

Maintenance App `5776881` has **no exception** in any rule layer. Its earlier `always` review/check exceptions were removed. App changes require a PR, normal independent review and all mandatory checks. Old direct-main promotion code must fail closed; never restore bypasses to make it work. Operational acceptance of a replacement maintenance workflow is separate from reading back these rules.

Consequences: preserve signed history, wait for the exact current head's complete checks and keep publication subject to separate authorisation. [GitHub administration](../GITHUB_WORKFLOW.md) records exact rule IDs, source snapshots and readback commands. Committing a JSON snapshot alone does not activate or change a server rule.
