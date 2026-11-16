# Dependency audit

Historical registry audit checked on 16 November 2026 against that checkpoint's lockfile. Advisory state can change independently; rerun `npm audit --omit=dev --audit-level=low` and `npm audit` for a current dependency decision. The locked application dependencies passed `npm audit --omit=dev --audit-level=low` with **zero reported vulnerabilities**. This is the registry audit result, not proof that all application code is secure.

The complete dependency audit reports four low-severity entries for **one underlying advisory**, [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4). The actual installed path is:

```text
vite-plugin-pwa@2.0.0
└─ workbox-build@7.4.1
   └─ @rollup/plugin-node-resolve@16.0.3
      └─ deepmerge@4.3.1
```

These are development/build dependencies. The advisory concerns prototype poisoning in merged output; its published affected range is 4.2.0–4.3.1 and the recorded advisory response listed no patched release. The repository's existing Dependabot alert remains open.

The audit's suggested `vite-plugin-pwa@0.2.1` is a major downgrade, not an upstream patch for the current PWA stack. It has not been applied or described as a safe fix. No alert was dismissed and no package was forced outside its supported dependency range.

Future maintenance should use a reviewed upstream fix once available, refresh the lockfile and run the full build/PWA and retained-data gates. Continue installing the locked official-registry dependency set; do not merge untrusted build configuration. See [the actual QA evidence](QA_RESULTS.md) and [maintenance controls](HOSTINGER_AUTOMATIC_UPDATES.md).
