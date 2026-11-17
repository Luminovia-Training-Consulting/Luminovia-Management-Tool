# Luminovia Portal repository instructions

Read and follow the root [AGENTS.md](../AGENTS.md) before changing this repository. It is the canonical agent handbook; read any applicable nested instructions as well.

Start with [README](../README.md), the [project guides](../README.md#documentation), [roadmap](../ROADMAP.md) and complete [master specification](../PRODUCT_BRIEF.txt). Preserve unrelated work and use a separate worktree when other work is in progress.

Keep the documented React/TypeScript/Vite/Supabase architecture. Database permissions, active-account status and current actor membership are authoritative; the current source disables MFA factors and AAL gates. Never put server keys or private data in browser code, Git, logs or screenshots. Use fictional, isolated test data.

Explain source and tests with meaningful English comments about purpose, contracts, permission boundaries and important failure/cleanup behavior. Preserve DE/EN UI and authored content. Keep released migration history immutable. Do not change pinned vendor snapshots, generated data or lockfiles merely to add comments; explain them in their companion documentation. Legitimate dependency, upstream and generated-data maintenance follows AGENTS.md and the documented update/generation paths.

Run the checks appropriate to the actual change and record what passed, failed or was not run. Follow the authorization boundaries and delivery rules in AGENTS.md; a source change does not authorize production, billing, DNS or messages to real people.
