# Luminovia Portal — project instructions

## Start and continuation

1. Read `docs/WORKLOG.md` first, then `docs/IMPLEMENTATION_PLAN.md`.
2. Read `docs/UNIVERSAL_MASTER_PROMPT.txt`. This is the user's complete authoritative product specification, preserved verbatim. Do not replace its scope with an MVP or a design prototype.
3. Inspect the current source, Git status and actual owning migrations/tests before continuing. Preserve working code and unrelated changes.
4. Select and complete a useful vertical slice, run the relevant checks, and update the work log and plan with actual results and immediate next actions.

## Project boundaries

- Work in this separate `Luminovia-Management-Tool` repository. The public `Website` repository and `https://luminovia.org` are read-only brand references.
- Do not deploy to production, change production data, DNS or hosting, send emails to real people, register services or make purchases without appropriate user authorisation.
- Use React, TypeScript, Vite, Tailwind/shadcn/ui and Supabase as specified. Do not introduce an additional application server without a demonstrated requirement.
- Server-side database permissions are authoritative. Never use editable user metadata or browser-submitted role/user IDs for authorisation. Never put Supabase service-role/secret keys in client code, Git, logs or screenshots.
- All job claims require online database confirmation. No optimistic confirmation, browser-only auth, routine approval queue, partial multi-day allocation or editable accepted commercial snapshots.
- Do not expose lecturer contracts, private calendar events or private messages through an administrator-wide bypass.
- All UI strings must support German and English; authored content stays in its authored language. Store time instants and preserve intended IANA time zones.
- Keep the full target scope in the plan even when a milestone implements only a subset. Label implemented, tested, blocked, untested and pending honestly. Never invent tests, sent invitations, deployed URLs, hardware/platform acceptance or legal compliance.
- Keep public documentation, filenames, UI examples and screenshots customer-neutral. Never name actual customers or publish their records; use clearly fictional organisations in development/tests. Actual customers and their account memberships are configured privately in the application. Do not copy personal CVs or customer records from brand sources.
- Brand assets and provenance are in `public/brand` and `docs/BRAND_DESIGN_SYSTEM.md`. Keep the seven-colour palette and official logo.

## Collaboration and deliverables

Delegate bounded independent work when useful and integrate it into a coherent application. Maintain the documented architecture, migration history, persistent plan, actual test evidence and operational runbook. Keep credentials out of all deliverables.

The user's teaching-material format rules apply if this project later produces course materials: slide scripts as PPTX with full German speaker text and moderation notes, other text and student assignments as PDF (assignments fillable), no Word delivery. Those curriculum output rules do not convert software documentation or source files into PDFs.
