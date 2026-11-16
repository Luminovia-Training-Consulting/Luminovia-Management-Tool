# Luminovia Portal repository instructions

Read and follow the root [AGENTS.md](../AGENTS.md) before changing this repository. It is the canonical agent handbook; read any applicable nested instructions as well.

Start with [WORKLOG](../docs/WORKLOG.md), [IMPLEMENTATION_PLAN](../docs/IMPLEMENTATION_PLAN.md) and the complete [master specification](../docs/UNIVERSAL_MASTER_PROMPT.txt). Preserve unrelated work and use a separate worktree when other work is in progress.

Keep the documented React/TypeScript/Vite/Supabase architecture. Database permissions, current actor membership and MFA are authoritative. Never put server keys or private data in browser code, Git, logs or screenshots. Use fictional, isolated test data.

Explain source and tests with meaningful English comments about purpose, contracts, permission boundaries and important failure/cleanup behavior. Preserve DE/EN UI and authored content. Released migrations, pinned vendor snapshots, generated data and lockfiles keep their exact bytes; use their companion documentation where comments are unsupported.

Run the checks appropriate to the actual change and record what passed, failed or was not run. Follow the authorization boundaries and delivery rules in AGENTS.md; a source change does not authorize production, billing, DNS or messages to real people.
