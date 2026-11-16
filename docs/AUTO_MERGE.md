# Verified native automatic merging

## Delivery status

Current Main12 quality composition includes accepted `2c7d326` and all 68 unchanged SQL files. Local checks pass 690 frontend cases/90 files, 341 unique runtime/maintenance cases (260 + 81), full types/lint/actionlint/format, the 197-module/46-route graph with zero issues and the production/PWA build with 86 precache entries. Whole-source V8 is S66.57/B61.98/F56.92/L68.70%; both APIs retain 100% across the 65 focused cases included in the frontend total. Package-concurrency correction `c24` is integrated as signed `5c8444d`, with 31/31 package cases passing in 6.78 seconds and the post-package combined 341-case run passing in 9.18 seconds. Remote merge `2659618` is preserved normally without changing those source bytes. The older `b9043df` CI against `99add7de` passed native compatibility, but system/browser were cancelled at 15:10 UTC after the remote update; no complete green or rebased acceptance is claimed. Fresh final-source system/browser/native/security/package gates remain required.

**Historical Main24 checkpoint:** This prepared native-merge and quality source includes accepted Main24 `99add7de8598bf415977c7cae79f1c5f6993626d`, all 68 released SQL migrations and the earlier Main36 parallel full-PR system/browser phases. The previous 62 released SQL paths/blobs remain unchanged. Local quality composition `a0a7b48` passes 690 frontend cases/90 files, 331 runtime/maintenance cases, full types/lint and the production/PWA build; the lifecycle and notification APIs separately retain 100% coverage across 65 focused cases. Acceptance of incoming revisions and local checks do not certify a later combined head. Fresh exact-head/current-base system, browser, native, security and package gates remain required. The complete product scope and remaining operational/platform acceptance stay in the implementation plan. The exact `7daaa7b` all-15-check pass remains historical.

The integrated revision still needs its own exact-head CI and merge. The first successful default-branch execution of this controller and its continuous read-only probe, and an observed native App merge by this controller, remain pending. Repository auto-merge availability, active branch rules, local quality results and the separate successful manual metadata proofs do not establish those outcomes. No accepted running-controller or native-App-write claim is made here.

The verified 16 November 2026 06:42 UTC server snapshot recorded **15 required checks, strict current-base enforcement and no CI bypass; a personal PR-only review exception solely for `CarinaSchoppe` (user `29256704`), with no role-based exception; no App review exception; and no history/signature bypass**. The matching source snapshots are linked in [GitHub administration](GITHUB_WORKFLOW.md#rules-for-main). At 12:16:58 UTC a historical readback found the review layer disabled, and the prepared controller rejected its missing policy with `native-policy`. A subsequent live readback confirms that layer active after its 13:38 UTC update, with the same personal-only exception and unchanged strict/history protections. The earlier disabled-policy blocker no longer describes current enforcement. Root did not change server settings or grant an exception.

## Main36 phase-integration boundary

Full-profile PRs now separate system/SQL/API verification and `Isolated browser acceptance` onto fresh independent stacks, alongside native retained-data verification. Complete acceptance requires all three actual full phases; neither one phase nor successful job names alone establish it. Main/manual/local application acceptance retains the complete original single-stack sequence.

The prepared controller now binds system, browser and native jobs and their actual successful steps to the same canonical CI suite/run/head/attempt. Its browser context is additional evidence; the native rule catalogue still has exactly fifteen required contexts. Pre-union Root source `41866c6` passed 318 runtime/maintenance cases, including missing/skipped browser and phase-binding regressions. The later Main24 quality composition passes 331 runtime/maintenance cases; the earlier union and local counts do not replace final-source CI. The earlier 304/90 cases remain source-bound to pre-Main36 `694cc4e`. Fresh exact-head GitHub acceptance and trusted-Main controller delivery remain pending.

## Prepared workflow and credential boundaries

The prepared **Verified automatic merge** workflow inspects trusted `main` source after relevant verification workflows complete, on manual dispatch and on its recovery schedule. It does not execute a PR checkout, install contribution packages, restore PR caches or run contribution artifacts.

Evidence uses the short-lived read-only `GITHUB_TOKEN`, provided as `GH_TOKEN`. Reads include fixed REST paths and the fixed GraphQL operation needed to bind the actual source push to the validated CI check suite. PR titles, bodies, links and API response URLs are never executable commands or arbitrary token destinations.

Only the existing repository-scoped maintenance App `5776881` (`luminovia-portal-maintenance`) supplies the separate write token. Its protected `maintenance-signing` environment and existing credentials are reused; no new App, personal token, key or scope is introduced. The write router permits only the native PR merge endpoint and the two main-verification dispatch endpoints. It permits no main-ref update, force update or arbitrary API write. The App has no review or CI bypass, and its short-lived token is revoked by the pinned token action.

The environment uses `deployment: false`: it retains the protected configuration without creating a deployment record for each merge sweep. The observed environment has a branch policy and no custom deployment-protection App. GitHub documents this [environment mode and its protection-rule compatibility](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments#using-environments-without-deployments). This controller does not publish releases or deploy an application.

## Candidate requirements

Every automatically merged candidate must satisfy all of the following:

- It is an open, ready, mergeable PR into this repository's current `main`, with valid type/area/risk labels and no `merge:hold`.
- All **15 required checks** pass on the current head and applicable current base: Build, Typecheck, Lint, Formatting, Code quality, Tests and coverage, full `verify`, actual isolated selfhost compatibility, PR metadata, PR preview package, the three language-specific CodeQL analyses, Dependency review and the separately generated CodeQL findings check. Required producer Apps, workflow paths, check suites and PR identities must match. Missing, pending, cancelled, neutral or failing required evidence blocks merging; additional checks and legacy commit statuses must also pass.
- The combined Main36 contract requires system, browser and native evidence bound to their actual jobs in the selected canonical CI run. Every mandatory full-acceptance step must have succeeded; skipped work or one successful phase is insufficient. A retained successful job from an earlier attempt of that same run remains usable when it is the job behind the selected current check. Job/step evidence is not a command-body attestation: independent review still must verify the maintained workflow and test implementation.
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

The prepared controller rejects Drafts and `merge:hold`. Current accepted Main12 does not yet machine-enforce the label, so PR19 remains Draft with no native auto-merge request and the hold retained as a coordination marker. Publish the signed integration as Draft; the later assigned Ready transition must start fresh full verification. This prepared metadata change rejects that hold, preventing native queued auto-merge from treating it as permission to proceed once the validator is accepted on Main. Before that delivery, GitHub itself does not interpret the label: keep the PR Draft or disable its queued native auto-merge as well. On 16 November, PR34 was held and its native auto-merge was disabled because its reduced verification profiles could return the same green application/native job contexts while skipping complete steps. GitHub subsequently records its accepted merge as Main `c5281002`; this follow-up preserves the optimization for verified Drafts and requires a fresh full run for every ready PR. PR34's own full-profile acceptance remains distinct from the later-profile concern. The additional job/step guard prevents green reduced contexts from authorizing this controller. After accepted PR36, it also requires the exact successful `Isolated browser acceptance` job and its complete desktop/mobile/PWA step, bound to the same current CI suite, head and check URL. System/native success cannot substitute for browser acceptance.

```bash
node --test scripts/runtime-pr-auto-merge.test.mjs scripts/runtime-pr-auto-merge-cli.test.mjs scripts/runtime-pr-metadata.test.mjs scripts/runtime-documentation.test.mjs
```

A real read-only inspection uses an existing authorised token in `GH_TOKEN`, the exact `GITHUB_REPOSITORY`, and `node scripts/pr-auto-merge.mjs`. The CLI writes only with explicit `--apply` and its separately configured App write token. Never paste credentials into command text, committed files, screenshots or reports.

The successful [read-only metadata proof, run 43809731348](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43809731348), checked access to the 15 required checks, CodeQL records, the source push and current pusher permissions using the standard restricted Actions token. The probe used signed fixture commit `f7f0bee`; its owned temporary branch was removed. It performed no App write or main write. This proves metadata access; it does **not** prove a native automatic merge, controller acceptance, full application acceptance or deployment.

The final fixed query, including immutable Bot IDs, also passed [actual read-only Actions run 43814730991](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43814730991) on signed fixture `2d0abce`. It checked GraphQL's bare `dependabot` login against REST's `dependabot[bot]` identity using the same numeric ID and ordinary read permissions. The owned fixture branch was removed. This remains a metadata-access proof, not an App merge or application deployment.

## Continuous read-only source probe

`node scripts/pr-auto-merge.mjs --probe-source <runID>` checks the canonical CI run, its suite/head/repositories and any known pusher's current immutable REST identity. It reuses the production fixed query and identity helper. It reads only the existing `GH_TOKEN`, rejects mixed apply/probe arguments and never creates a write client, enumerates PRs, dispatches workflows or merges. A null push remains a valid metadata observation and grants no exception.

The Code-quality matrix entry invokes this probe for its own `GITHUB_RUN_ID` after dependency setup, with six read-only token scopes and no App credential, environment or deployment. This provides a continuous actual Actions-token contract once the updated source runs in CI. Local unit/real-child-process fixtures pass. The continuous step actually succeeds on signed PR head `e49862b` in [Code-quality job133202246088](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43838873452/job/133202246088): exact suite118677141501, head and immutable pusher29256704 using only the restricted Actions token. This does not establish a running Main controller or native App merge. The earlier manual fixed-query proof43814730991 remains a separate successful observation.
