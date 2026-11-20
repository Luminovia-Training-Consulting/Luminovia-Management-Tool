# Design QA — operational portal revision

**Native review completed; full canonical suite pending.**

On17November2026 the UI was inspected in real authenticated Chromium sessions against an owned local Supabase stack. The supplied dashboard/course/jobs/operations images and TODO list guided the review. The missing Codex in-app controller from the earlier attempt was worked around with the installed Playwright Chromium runtime; these are actual application screenshots, not HTML fixtures.

- 52 administrator/lecturer/company route combinations at1440px desktop and390px mobile; no final page JavaScript errors or horizontal overflow.
- 21 actual admin routes passed automated axe WCAG2A/AA/2.1AA checks.
- Main dashboard, jobs, courses, workspace, files, profile/person management, settings, support, communication and knowledge views inspected. Settings/header additionally checked at320/760px and in English/dark mode.
- Native form saves, blocking/reactivation, role changes, permanent deletion of a disposable lecturer, whole-course claim/overlap denial, company review and scoped-membership revocation verified against actual server results.
- Corrected mobile file overflow/filter alignment, blocked-person management dead end, dashboard density/order, header/account navigation, duplicate theme-control IDs and synchronization, stale retired-module links/search results and misleading action labels.

See [the complete TODO acceptance mapping](docs/UI_ACCEPTANCE_20261117.md). Private rendered evidence is retained in ignored .local/ui-acceptance, .local/design-review, .local/profile-audit and .local/ui-review. Only fictional local data were used. The owned review stack and its data volumes were removed after acceptance.

This establishes the observed UI behaviour and responsive layouts, not pixel-for-pixel equivalence to generated concept images or every possible data-dependent state. The updated all-history canonical browser suite has not completed because its shared QA lock belongs to another checkout.

## Historical review attempt (superseded by native review above)

**Final result: blocked**

## Source and implementation evidence

- Source visual truth: the four user-provided dashboard, course workspace, jobs and operations screenshots attached in the conversation. Their listed local paths under `/home/carinaschoppe/Downloads/` are unavailable from this checkout, so exact pixel dimensions and density could not be inspected here.
- Intended implementation: authenticated Luminovia Portal shell and corresponding dashboard, course, jobs and operations routes in this repository.
- Implementation screenshot: not captured. The local portal is now running and its URL was opened in Codex; the requested Codex in-app browser surface remains unavailable to the controller (`agent is not defined`).
- Viewport, CSS dimensions and device scale: not captured; no source/implementation normalization was possible.
- Intended state: signed-in customer/staff workspace, using each actor's real authorized data and capabilities. Screenshot names and records are illustrative only.

## Comparison evidence

- Full-view comparison: unavailable because the authenticated implementation could not be rendered in the in-app browser.
- Focused regions: unavailable for the same reason; sidebar, page heading, KPI/cards, course workspace, job board and operations hub need review after runtime recovery.
- Typography, spacing, color, image fidelity and application copy: source guidance was read from the supplied images; rendered fidelity has not been evaluated.

## Implemented before visual comparison

- Added the official Luminovia mark and portal label to the shared sidebar.
- Set first-use navigation to expanded labels while preserving saved collapsed preferences.
- Updated shared color tokens, active navigation, workspace spacing, page headings, panels, controls, tables and dashboard metrics to the clean navy/blue/pastel direction.
- Kept screenshot customer names and records out of the application.

## Comparison history

No rendered comparison pass occurred. No P0/P1/P2 findings were recorded from an implementation screenshot, and no visual pass is claimed.

## Blocker and next review

Capture and compare authenticated desktop and mobile screenshots for the four supplied workflow types in the Codex Desktop in-app browser once its controller is available. Fix any P0/P1/P2 issues and repeat the comparison before changing the result to `passed`.

## 2026-11-17 workspace clarity revision — native review

Scope: the reported chat/profile layout problems, notification category controls, Knowledge & Help support navigation, and minimal guest profile/settings/help. This revision does not certify all portal screens. The earlier entries above are historical evidence and remain unchanged.

Source truth: `/tmp/codex-clipboard-b2dbd484-7ecb-41b8-9cf8-a58200ca9270.png` (chat, 2069×1186), `/tmp/codex-clipboard-9d0215ba-f102-4516-9116-98e482b5bbcf.png` (profile action, 2069×1186), `/tmp/codex-clipboard-c7f80684-812a-4e3a-a923-fa8c3871243f.png` (privacy preferences, 1712×1005), and `/tmp/codex-clipboard-ba2eb5af-b066-4028-a0b8-f8f859ac3f3b.png` (349×201 active/archive/lounge fragment). These are screenshots of problems to improve, not desired layouts to copy. Source browser viewport,
device scale, and crop are unknown; exact pixel fidelity is therefore not claimed.

Implementation: authenticated native React application at `http://127.0.0.1:6473`, connected to the isolated local Supabase API62321 with genuine seeded admin and a temporary guest. Only a fictional private room with five authored messages and an own guest were added, then removed. Browser controller was Playwright Chromium because no Codex in-app browser controller was exposed. No fixture HTML or mocked network responses were used.

Evidence directory: `.local/native-review/source/.local/clarity-evidence/`. Repeatable script: `.local/clarity-ui-audit.mjs`. Desktop2069×1186, mobile390×844, dark1440×1000; guest1440×900 and390×900; deviceScaleFactor1. Whole-page PNGs preserve scrollable content; focused screenshots capture actual workspace/privacy regions. Comparison montages fit each original independently inside a labelled1100px region, preserving aspect ratio. They support composition comparison rather than a false pixel
diff across differently cropped screenshots.

### Findings and comparison passes

1. Desktop composition: opened both source and corrected native artifacts together in `desktop-chat-comparison.png` and `desktop-profile-comparison.png`, plus full-page `chat-desktop.png`/`profile-desktop.png` and focused `chat-workspace-desktop.png`/`profile-privacy-desktop.png`. The reported P1 tiny transcript and oversized persistent composer are fixed: optional search/pins/information collapse to one row, the actual transcript measures649px and the composer retains drafts across disclosure
   toggles. The P2 cramped conversation titles are fixed by putting the title/preview across the full row with secondary actions beneath. Active/archive controls have18px separation from the lounge. The P1 huge middle profile action is removed and available in the page header; the two privacy cards share an813px-wide desktop row instead of leaving the right side empty. No further actionable desktop P0/P1/P2 was found in this scope.
2. Responsive and state pass: inspected `mobile-review.png`, actual focused mobile captures, `bell-mobile.png`, `support-mobile.png`, and guest settings/help captures. At390px the chat uses one pane with a303px transcript, reachable send/attachment controls and preserved draft; privacy cards stack without clipping. Six labelled notification categories fit a three-column preview, and the empty finance category explicitly says that no loaded messages match. Full inbox filtering explicitly applies
   only to loaded pages; it does not imply a history-wide server filter. Support is a Knowledge & Help tab, with direct routes preserved. Genuine guest login sees only own profile/settings/help, redirects `/jobs` to `/profile`, and sends no notification, announcement, teaching, qualification, job discovery or deletion RPCs. Only `portal_access` was requested. The subsequent full inbox capture exposed a P2 mobile category-strip clipping issue when a later category received focus. The narrow page
   selector was changed to the same three-column/two-row grid as the preview, with44px minimum target height. The final refreshed native run verified exactlytwo rows, everybutton within the390px viewport, minimum44px targets; `inbox-mobile.png` was recaptured and opened. This finding is closed.
3. Dark pass: native `profile-privacy-dark.png` initially exposed a P2 contrast defect in shared primary buttons: navy text from the existing dark override on the later fixed blue background. Root changed the shared dark primary text to white. The first post-fix attempt correctly detected stale served CSS despite corrected source files. After the owning candidate restart, fresh native screenshots and a computed-color assertion verified white rgb(255,255,255) labels on blue rgb(7,88,232) in all
   three views. The final dark comparison was opened together with the source in `dark-final-comparison.png`; the contrast finding is closed.

### Required fidelity surfaces

- Typography: existing Space Grotesk headings and Inter/system body stack retained; no replacement fonts/assets introduced. Full-width room titles, wrapped body copy and privacy headings are legible in desktop/mobile captures. No claim of identical rasterization to a source with unknown density.
- Spacing/layout: corrected transcript/composer proportions, room title tracks, segmented-control gap and two-column privacy layout verified from actual element bounds. Mobile intentionally stacks privacy forms and uses the single-pane chat navigation.
- Color/tokens: cream/navy, blue actions and mint lounge retain the portal brand. Initial dark primary contrast was a real finding, recorded above and verified fixed after refresh.
- Imagery/assets: official existing shell logo and decorative brand assets retained. This revision adds no generated illustrations or replacement SVG art. Lucide action icons remain genuine interactive controls, with accessible labels preserved.
- Copy/content: DE/EN strings added for disclosures/categories; authored fictional chat messages retain their language. Privacy instructions and mutation/error semantics remain unchanged. Category labels describe bounded loaded data honestly. Finance notifications are recipient-private; the admin's empty finance category is expected, not evidence of another person's invoice access.

### Verification and limits

Native script passed all functional/layout checks for the three admin and two guest viewport states, then removed its own fixtures. Chat transcript heights649/303/463px; privacy813px+813px on2069 desktop and362px stacked on390 mobile. Document width equalled viewport width in the support and guest states; admin pageErrors were empty. Unit evidence includes28 focused chat/offline/shell tests,57 notification/category/navigation tests and92 chat/profile-related tests from the implementation run;
root owns the complete suite evidence. Targeted ESLint and TypeScript build passed.

The final native run exited0, confirmed all six mobile categories visible and dark primary labels white, and removed only its own fictional fixtures. No P0/P1/P2 remains in the reviewed scope. Empty support/invoice states were reviewed; populated finance event delivery/SQL permissions are separate root-owned evidence. This scoped review does not certify all application workflows or pixel-identical reproduction of illustrative mock records.

Final result: passed (scoped chat/profile/notification/support/guest revision; limitations above).