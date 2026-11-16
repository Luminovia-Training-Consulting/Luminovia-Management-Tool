# Guided exploration and help

The demo and help are public application routes, available from sign-in without an account. They complement the real portal; they do not replace authentication, server permissions or the account-specific welcome checklist.

## Try the sample-data demo

Choose **Try the sample-data demo** (**Demo mit Beispieldaten ausprobieren**) at sign-in to open `/demo`. All 25 module areas are available through demo navigation and a guided sequence. For example, `/demo/jobs` opens the job exercise; `/demo?module=jobs` also selects it. The demo continuously identifies its content as fictional.

Try full multi-day claims, rejection scenarios, calendar, chat, profile, document scanning and invoice steps using fictional data. Every result is simulated. No action books real work, uploads files, sends messages, invitations or emails, or signs an agreement. The demo role changes the educational perspective only and grants no portal permissions.

The **Guided tour** (**Geführter Rundgang**) explains the areas in sequence. Use previous/next, pause and restart at your own pace. Switching between German/English or changing the theme keeps the current exercise. **Reset demo** (**Demo zurücksetzen**), reloading or leaving the demo discards exercise input. Never enter real names, personal/customer data, secrets or document contents. Ordinary language/theme preferences remain separate and are retained.

## Use the authenticated portal tour

The authenticated **Portal tour** (**Portal-Rundgang**) navigates only after your explicit choice and uses current account roles/permissions to select relevant destinations. It explains real workflows and their next steps without executing business actions. Real controls still require their normal checks and online server confirmation. Use the fictional demo to practise without performing real business actions.

Only the tour step/status is kept in this browser's session storage, separately for each account. Pause/resume works across page navigation and reloads within the same browser session. This is not a server-synchronised or cross-account completion record. Storage denial falls back to in-memory operation.

## Open help and guides

Open **Help & guides** (**Hilfe & Anleitungen**) at `/help` for searchable step-by-step instructions, common problems and practical recovery steps in both languages. Deep links such as `/help?topic=jobs` select a module, and `/help?topic=files` opens file guidance. `/help?topic=troubleshooting` explains connection problems, missing permissions, unconfirmed actions and safe issue reporting. General error displays link there.

Interface instructions are authored in German and English; real authored customer/course content is never translated by this feature.

## Implementation and operating boundary

- `src/features/help/catalog.ts` owns bilingual instructions for actual portal modules. Changes to live workflows should update that catalogue and tests together.
- Demo components import no Supabase/API client and hold exercise inputs only in React memory. Public help contains authored documentation only. An existing signed-in session may still undergo the application's ordinary global Auth refresh; this is independent of demo actions.
- The live tour is presentation/navigation only. It never grants permissions, imitates a real session, invokes mutation APIs or confirms a real claim. Administrative and commercial stops follow the current shell's role/permission predicates; both permissions remain necessary for qualification administration.
- Public routes expose no private records. Existing PostgreSQL, Storage, Auth, MFA and API policies are unchanged. No database migration, new dependency, service registration or hosting configuration is required.
- Public help and fictional demo application code can be included in the existing PWA shell cache. Exercise input and private records are not added to a cache or browser storage.
- This PR does not certify every remaining master-specification feature or deploy to production. The usual successful CI release gates still apply to authorised development updates.

## Verification

`npm test`, `npm run test:coverage`, `npm run typecheck`, `npm run lint`, `npm run format:check` and `node scripts/code-integrity.mjs --exports` cover source quality and regression checks. `npx playwright test --config scripts/guided-demo-playwright.config.ts` runs public desktop/mobile browser checks against a separate frontend with synthetic configuration, without a database. It aborts and fails attempted backend calls in fresh public sessions. The same browser specification also runs inside the ordinary complete `./portal test` CI workflow, which separately verifies real authenticated business behavior and retained data. Actual outcomes are recorded in QA_RESULTS; this command list is not itself a pass record.

Follow-up functional/dead-code review and concrete regression evidence: [GUIDED_EXPERIENCE_AUDIT](GUIDED_EXPERIENCE_AUDIT.md).

The separate account-specific `/welcome` checklist persists its own progress through server-confirmed writes. Automatic welcome content is shown only while the live Portal tour is inactive. On `/welcome` and `/welcome/`, the live tour keeps its stored step but hides its controls so the two walkthroughs do not compete. Neither walkthrough advances or completes the other's state; the manual welcome route is deliberately not a live-tour stop.
