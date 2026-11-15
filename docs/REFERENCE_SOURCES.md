# Primary reference sources and version checks

Checked during the 15 November 2026 development session. These links support architecture/API choices; the repository lockfile and actual executed tests own the tested version set. No changelog summary is a substitute for local/managed-stage acceptance.

## Supabase changes relevant to this project

- [Supabase changelog index](https://supabase.com/changelog.md), checked for relevant breaking changes.
- [CLI v3 change notice, 4 November 2026](https://supabase.com/changelog/supabase-cli-v3): database/storage commands now default to the local stack; hosted targets require explicit selection and hosted mutations require confirmation. Environment/flag precedence changed; legacy `[inbucket]` became `[local_smtp]`. This project pins CLI `3.1.0`; inspect its actual `--help` before modifying commands or CI. A migration-history column labelled “remote” does not by itself establish a hosted operation.
- [CLI 3.1.0 release, 9 November 2026](https://github.com/supabase/cli/releases/tag/v3.1.0): browser calls to `/functions/v1` need CORS/preflight handling in the function itself; local gateway behaviour no longer supplies permissive headers automatically. This matters for the invitation Edge Function. Remote certificate handling and configuration checks also changed; review the release when altering connection/deployment scripts.
- [Supabase database functions](https://supabase.com/docs/guides/database/functions): transactional PostgreSQL RPC and function privileges/security context. Portal public wrappers use invoker semantics; privileged implementations are isolated, actor-checked and grant-restricted.
- [JavaScript password recovery API](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail), retrieved using the connected Supabase documentation search: supports PKCE and redirect-based password recovery. Portal must allow the actual implemented callback URL and test the whole flow.
- [JavaScript assurance-level API](https://supabase.com/docs/reference/javascript/auth-mfa-getauthenticatorassurancelevel) and [MFA guide](https://supabase.com/docs/guides/auth/auth-mfa), retrieved using connected documentation search: enrollment/challenge alone does not secure business operations; database/API authority must enforce the required verified AAL. Production factor lifecycle/recovery still requires acceptance.

The documentation search returned a stale/unavailable direct `auth/server-side/pkce-flow` web route during this session; the current JavaScript reference was used instead. Do not claim a successful page fetch for that route.

## Frontend compatibility

The parent implementation checked [Vite getting started](https://vite.dev/guide/) and [Tailwind's Vite integration](https://tailwindcss.com/docs/installation/using-vite) before setup. Pin exact dependency versions and retain `package-lock.json`. All FullCalendar packages in this milestone use the same `6.1.22` version; the Luxon3 plugin supplies IANA-zone calendar handling. Do not mix a newer plugin with an older core or invent unavailable package versions.

## Brand authority

[Live Luminovia website](https://luminovia.org/), [Website repository](https://github.com/Luminovia-Training-Consulting/Website) and source commit `2778a9be96b7d6c29ec0f11a1677c7530c602ccc`. Exact CSS/logo/font provenance and hashes are in [BRAND_DESIGN_SYSTEM.md](BRAND_DESIGN_SYSTEM.md). The public website is read-only; portal deployment remains separate.
