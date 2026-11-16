# Verified native automatic merging

## Delivery status

This prepared native-merge and quality source includes actual main `c0622a763127081a7b5be092ce2782253991c6a5` (PR29 documentation after PR10), with all 36 SQL migrations and the already accepted M7 application source. It retains the accepted English documentation and customer-neutral course catalogue, and integrates the focused quality and course-regression work. Acceptance of those incoming revisions does not certify a later combined head; the complete product scope and remaining operational/platform gates stay in the implementation plan. The exact `7daaa7b` checkpoint passed all 15 checks; later documentation and controller changes need fresh applicable evidence.

The integrated revision still needs its own exact-head CI and merge. The first successful default-branch execution of this controller and its continuous read-only probe, and an observed native App merge by this controller, remain pending. Repository auto-merge availability, active branch rules, local quality results and the separate successful manual metadata proofs do not establish those outcomes. No accepted running-controller or native-App-write claim is made here.

The verified 16 November 2026 06:42 UTC server snapshot records **15 required checks, strict current-base enforcement and no CI bypass; a personal PR-only review exception solely for `CarinaSchoppe` (user `29256704`), with no role-based exception; no App review exception; and no history/signature bypass**. The matching source snapshots are linked in [GitHub administration](GITHUB_WORKFLOW.md#rules-for-main). A later live readback found the review layer disabled; the stored personal exception does not activate it. The controller rejects that missing active policy with `native-policy` while user clarification is pending. This implementation does not change server rules or grant a new exception.

## Prepared workflow and credential boundaries

The prepared **Verified automatic merge** workflow inspects trusted `main` source after relevant verification workflows complete, on manual dispatch and on its recovery schedule. It does not execute a PR checkout, install contribution packages, restore PR caches or run contribution artifacts.

Evidence uses the short-lived read-only `GITHUB_TOKEN`, provided as `GH_TOKEN`. Reads include fixed REST paths and the fixed GraphQL operation needed to bind the actual source push to the validated CI check suite. PR titles, bodies, links and API response URLs are never executable commands or arbitrary token destinations.

Only the existing repository-scoped maintenance App `5776881` (`luminovia-portal-maintenance`) supplies the separate write token. Its protected `maintenance-signing` environment and existing credentials are reused; no new App, personal token, key or scope is introduced. The write router permits only the native PR merge endpoint and the two main-verification dispatch endpoints. It permits no main-ref update, force update or arbitrary API write. The App has no review or CI bypass, and its short-lived token is revoked by the pinned token action.

The environment uses `deployment: false`: it retains the protected configuration without creating a deployment record for each merge sweep. The observed environment has a branch policy and no custom deployment-protection App. GitHub documents this [environment mode and its protection-rule compatibility](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments#using-environments-without-deployments). This controller does not publish releases or deploy an application.

## Candidate requirements

Every automatically merged candidate must satisfy all of the following:

- It is an open, ready, mergeable PR into this repository's current `main`, with valid type/area/risk labels and no `merge:hold`.
- All **15 required checks** pass on the current head and applicable current base: Build, Typecheck, Lint, Formatting, Code quality, Tests and coverage, full `verify`, actual isolated selfhost compatibility, PR metadata, PR preview package, the three language-specific CodeQL analyses, Dependency review and the separately generated CodeQL findings check. Required producer Apps, workflow paths, check suites and PR identities must match. Missing, pending, cancelled, neutral or failing required evidence blocks merging; additional checks and legacy commit statuses must also pass.
- The current application and native checks bind to their actual jobs in the selected canonical CI run. Their mandatory complete-acceptance steps must have succeeded; a green job that skipped the full application or native step is insufficient. A retained successful job from an earlier attempt of that same run remains usable when it is the job behind the selected current check. Job/step evidence is not a command-body attestation: independent review still must verify the maintained workflow and test implementation.
- Actual CodeQL analysis records match the validated current PR test-merge revision and report zero findings. Scanner completion alone is insufficient. Findings freshness follows the actual latest CodeQL language jobs, so a targeted Dependency review retry does not invalidate retained successful scans.
- There is an independent, non-dismissed approval of the exact current head by a reviewer with current `write` or `admin` base permission; standard Maintain reviewers have the `write` base permission. The reviewer cannot be the PR author or a proven source pusher. Current immutable identity and permission bindings are checked again before merging.
- GitHub's native `mergeable_state` is **`clean`**. An approval does not override native blocking for unresolved conversations, stale reviews, latest-push approval or other branch requirements. An outstanding change request blocks the controller.
- No other open PR head is contained in the candidate, including a draft or held PR. Combined work must not silently consume another pending change.

**The controller has no author-based review exemption.** Maintainer-authored, administrator-authored, writer-authored, external and automated PRs all follow the independent-review and native-clean path above. Only `CarinaSchoppe` (user `29256704`) retains a personal PR-only exception when performing a native merge. It is not inherited by the App; the controller grants no author, user, role or workflow-actor exception, including for Carina-authored PRs.

## Actual push provenance

The source pusher comes from the actual push associated with the exact validated CI check suite and PR source revision. Current permission and immutable identity are checked against that real pusher. A workflow's `actor`, its retry initiator, reopening/editing a PR, a rebuild and a commit author name or email do not establish who pushed the reviewed source.

Missing push evidence grants no exemption: ordinary independent review and native `clean` remain mandatory. Contradictory push, head/base, identity or permission evidence blocks the candidate. A reviewer cannot acquire authority merely because someone with a stronger role reran an earlier workflow.

## Native merge and commit identity

The controller rereads candidate evidence and calls GitHub's native `PUT /pulls/{number}/merge` with the expected current head SHA and `merge_method: merge`. GitHub applies the active strict checks, review requirements and history/signature rules. A refusal is reported as a failure; the controller does not fall back to a ref write, a force operation or a ruleset bypass.

The head condition is not an atomic comparison of both Git refs. Native merging may create a new merge commit whose SHA differs from the synthetic test-merge SHA. This controller therefore makes **no exact-test-merge-commit or atomic-base guarantee**. It preserves the expected-head condition, checks current evidence and relies on GitHub's native current-base enforcement. Main is verified again after a confirmed merge. A failed or unconfirmed response is not reported as a completed merge.

If the existing App lacks a permission needed for a particular change, the request fails closed. No additional permission is requested automatically. An authorised human can use the ordinary native PR path after its applicable checks and review conditions are satisfied.

## Main verification and recovery

Every apply sweep reconciles current-main Portal checks and Security analysis before inspecting open PRs. After a confirmed native merge, missing main verification is reconciled again. The App can trigger ordinary push workflows; explicit dispatch recovers a missing run without assuming that push processing has completed. The Portal dispatch binds `expected_commit` to the observed main SHA.

Existing runs, including failed runs, are not silently retried or labelled successful. Resolve the cause and use the documented retry process. A later sweep can recover a lost merge response or failed dispatch by inspecting actual current main, without repeating an unconfirmed merge or publishing an application. Stale-base evidence and merge conflicts require an ordinary branch update and new acceptance.

This controller merges eligible PRs and requests verification. It does not publish a release, install an update, change hosting or authorise production work. Release and installation controls have their own owning workflows, operational evidence and approval boundaries.

## Hold, local checks and observed evidence

Keep unfinished work as a draft or add `merge:hold`. This prepared metadata change rejects that hold, preventing native queued auto-merge from treating it as permission to proceed once the validator is accepted on Main. Before that delivery, GitHub itself does not interpret the label: keep the PR Draft or disable its queued native auto-merge as well. On 16 November, PR34 was held and its native auto-merge was disabled because its reduced verification profiles could return the same green application/native job contexts while skipping the complete steps. The current PR34 itself uses the full profile; the conflict affects later feature PRs.

```bash
node --test scripts/runtime-pr-auto-merge.test.mjs scripts/runtime-pr-auto-merge-cli.test.mjs scripts/runtime-pr-metadata.test.mjs scripts/runtime-documentation.test.mjs
```

A real read-only inspection uses an existing authorised token in `GH_TOKEN`, the exact `GITHUB_REPOSITORY`, and `node scripts/pr-auto-merge.mjs`. The CLI writes only with explicit `--apply` and its separately configured App write token. Never paste credentials into command text, committed files, screenshots or reports.

The successful [read-only metadata proof, run 43809731348](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43809731348), checked access to the 15 required checks, CodeQL records, the source push and current pusher permissions using the standard restricted Actions token. The probe used signed fixture commit `f7f0bee`; its owned temporary branch was removed. It performed no App write or main write. This proves metadata access; it does **not** prove a native automatic merge, controller acceptance, full application acceptance or deployment.

The final fixed query, including immutable Bot IDs, also passed [actual read-only Actions run 43814730991](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43814730991) on signed fixture `2d0abce`. It checked GraphQL's bare `dependabot` login against REST's `dependabot[bot]` identity using the same numeric ID and ordinary read permissions. The owned fixture branch was removed. This remains a metadata-access proof, not an App merge or application deployment.

## Continuous read-only source probe

`node scripts/pr-auto-merge.mjs --probe-source <runID>` checks the canonical CI run, its suite/head/repositories and any known pusher's current immutable REST identity. It reuses the production fixed query and identity helper. It reads only the existing `GH_TOKEN`, rejects mixed apply/probe arguments and never creates a write client, enumerates PRs, dispatches workflows or merges. A null push remains a valid metadata observation and grants no exception.

The Code-quality matrix entry invokes this probe for its own `GITHUB_RUN_ID` after dependency setup, with six read-only token scopes and no App credential, environment or deployment. This provides a continuous actual Actions-token contract once the updated source runs in CI. Local unit/real-child-process fixtures pass. The continuous step actually succeeds on signed PR head `e49862b` in [Code-quality job133202246088](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43838873452/job/133202246088): exact suite118677141501, head and immutable pusher29256704 using only the restricted Actions token. This does not establish a running Main controller or native App merge. The earlier manual fixed-query proof43814730991 remains a separate successful observation.
