# 0002 — Main protection and merge authority

Status: live server readback on 16 November 2026 at 06:25 UTC; supersedes earlier disabled-rule, role-based-review, personal PR-only and maintenance-App-exception snapshots.

At that reviewed snapshot, all three rulesets were active. The source preserves this reviewed active configuration; live server rules are authoritative and may later differ. Default-branch signatures, deletion and force-push restrictions have no bypass actors. All **15 required checks** and strict current-base verification apply to every identity: fourteen contexts are bound to GitHub Actions integration `15368`, and the generated `CodeQL` findings result to integration `57789`.

The review ruleset grants only `CarinaSchoppe` (`User:29256704`) `bypass_mode: always`. This exception applies only within that ruleset. It can bypass its PR/review conditions, CodeQL thresholds (`high_or_higher` security alerts, `errors` alerts), code-quality errors and Copilot review on pushes (drafts excluded). It does not bypass the separate required-check or history/signature layers, including their CodeQL, Code quality and history-integrity requirements. Other users, repository roles, bots and Apps have no exception. An author identity does not transfer Carina's exception to another merge actor.

Maintenance App `5776881` has no exception in any rule layer. Historical token tests establish no current merge authority. Existing direct-main promotion must fail closed if these rules prevent it; do not restore bypasses to make it work. Replacement maintenance needs its own verified source and operational evidence.

Consequences: preserve signed history, wait for complete checks on the exact current source and treat publication as a separate authorized operation. Current `main` still contains automatic development publication; the requested local-first/manual-only replacement is pending in [PR #27](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/27). [GitHub administration](../GITHUB_WORKFLOW.md) records exact rule IDs, source snapshots and readback commands. Committing a JSON snapshot alone does not activate or change a server rule.
