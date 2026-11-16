# 0002 — Main protection and merge authority

Status: live server snapshot verified on 16 November 2026 at 06:42:36 UTC. Live server rules are authoritative and may later differ from source snapshots.

At that snapshot, all three rulesets were active. Default-branch signatures, deletion and force-push restrictions have no bypass actors. All **15 required checks** and strict current-base verification apply to every identity: fourteen contexts are bound to GitHub Actions integration `15368`, and the generated `CodeQL` findings result to integration `57789`.

The review ruleset contains only its pull-request rule and grants only `CarinaSchoppe` (`User:29256704`) `bypass_mode: pull_request`. She may merge a PR, including her own, without a separate approving review. The personal PR-only exception does not authorize direct-main pushes or bypass the separate required-check and history/signature layers. Other users, repository roles, bots and Apps have no exception. An author identity does not transfer Carina's exception to another merge actor.

Maintenance App `5776881` has no exception in any rule layer. Historical token tests establish no current merge authority. Existing direct-main promotion must fail closed if these rules prevent it; do not restore bypasses to make it work. Replacement maintenance needs its own verified source and operational evidence.

Consequences: preserve signed history, wait for complete checks on the exact current source and treat publication as a separate authorized operation. The accepted local-first controls from [PR #27](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/27) require explicit manual publication. Merges do not publish releases or PR deployment metadata. Release dispatch requires `publish_release=true` and the exact current `main` SHA as `expected_commit`; checks and daily maintenance alone do not publish. [GitHub administration](../GITHUB_WORKFLOW.md) records exact rule IDs, source snapshots and readback commands. Committing a JSON snapshot alone does not activate or change a server rule.
