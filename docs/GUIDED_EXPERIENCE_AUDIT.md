# Guided experience functional and connectivity audit

Scope: follow-up review of PR16 on merged main `e75f55d`, covering all29changedfiles, their actual runtime consumers and the existing frontend integrity checker. The audit is isolated from the original checkout's unfinished pricing/roles/welcome/preview work. The public website, normal databases, hosted services and existing migration history are unchanged.

## Reproduced defects and corrections

| Trigger                                                                                 | Previous result                                                                                                                                                    | Correction and regression                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The actual permission query fails while the private Shell loads                         | The Portal tour stayed disabled with an indefinite “waiting” message and no recovery action                                                                        | Distinguish loading/error, offer DE/EN explicit retry wired to both current role/permission queries, disable repeat retry while fetching; Shell test failed before the fix and now passes. A genuine-account browser case deliberately aborts the permission RPC, restores the real endpoint and retries before touring. |
| Open the jobs help guide, search, then select jobs again                                | The topic string did not change, so the existing focus effect never revealed/announced the selected article                                                        | Follow actual router navigation identity, retaining search input focus during typing. New Help regression failed before correction; same-topic keyboard focus is also checked in desktop/mobile browsers.                                                                                                                |
| Claim the initial demo block, then try to publish another title                         | Publication stayed editable even though its new card would inherit the previous claim; published-first mode also showed an unrelated original claim title/calendar | Keep one explicit complete-block exercise: published title is its actual claim/calendar identity; an accepted block cannot be republished or silently renamed before reset. Both new state regressions failed on the original and pass with the fix.                                                                     |
| A function/value export is referenced only through TypeScript `typeof` type annotations | The integrity checker counted erased type references as runtime use, hiding genuinely unused exports                                                               | Ignore erased type AST nodes; preserve genuine runtime `typeof`, calls and shorthand. Regression includes aliases and numeric values. A separate case preserves class declaration/expression `extends Base<T>` execution while excluding erased generic/implements/interface references.                                 |

## Dead code actually removed

- Four unreachable fallback checks for demo contracts, wiki, forum and client pages, which already have explicit earlier branches.
- Five unused translation keys: live-tour start/restart, Help back/context, demo language (the shared Preferences owns that control).
- Five never-read catalogue role/permission fields and their now-unused teaching constant. Commercial OR checks and dual-permission qualification checks remain in the actual tour selector and are tested.
- Two inert class markers with no stylesheet or other consumer. Accessible region names/heading associations remain in place.

No functioning component, legitimate CLI/server/test entry point, authored guide or supported application route was deleted to satisfy an analyser.

## Actual connectivity

| Entry                      | Runtime connection                                                    | Observable effect                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.tsx` → App       | Actual lazy `/demo/*` and `/help` routes                              | Public pages load without an account; private routes retain the original Protected/Shell boundary                                           |
| Sign-in and shared errors  | Existing translated links to demo/help                                | Browser checks click the actual sign-in demo control; generic errors link to recovery                                                       |
| Private Shell → PortalTour | Current actor/roles/permissions and explicit query retry              | Real route navigation, accessible progress/focus, validated per-account session state; no business mutation                                 |
| Demo navigation and forms  | React state/event handlers and shared catalogue                       | Publishing/claims/calendar/chat/profile/files/invoice/wiki/forum exercises change the visible fictional state; reset/reload/exit discard it |
| Help navigation/search     | Real query parameters, result links and navigation focus              | A selected guide and practical recovery steps appear in the chosen interface language                                                       |
| Shared Preferences         | Existing language/theme preference functions and theme media listener | All entry pages keep the existing language/theme behavior; demo exercise inputs are not persisted                                           |

The stricter actual audit finds112frontendmodules and225runtimeexports, with no unreachable modules, unresolved imports, invalid literal internal links, missing assets or unused runtime exports. This static graph verifies connections, not arbitrary control-flow execution; manual source tracing and behavior tests supply the complementary evidence.

## Executed acceptance

- Fresh `npm ci`; whole-source TypeScript, ESLint and Prettier pass.
- Whole-source V8:231unit/componenttests in49files pass; S49.69/B44.38/F40.06/L51.49%. Existing source coverage inclusion and thresholds are unchanged.
- Public real Chromium:10/10desktop/mobile cases pass, including DE/EN, light/dark, axe/no-overflow, all25demo stops, connected exercise/reset/reload, login→demo, same-topic Help focus and zero attempted backend calls in fresh sessions.
- Nine integrity guards plus the existing documentation-link check pass. Synthetic production/PWA build passes.
- The extended real-account failed-permission→retry browser path runs in the canonical disposable CI project. Its new exact-source combined/native/security acceptance is recorded on the follow-up PR. The prior PR16 acceptance (84browsercases,2built-PWAcases and actual selfhost/private-byte retention) is historical evidence and is not relabelled as execution of this new regression.

The repository's full remaining product scope is retained. This audit reports reproducible fixes and tested behavior; it does not claim mathematical absence of all bugs, production acceptance or hardware/browser-platform certification.
