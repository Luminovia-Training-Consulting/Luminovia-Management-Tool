# Guided exploration and help / Geführte Demo und Hilfe

The demo and help are public application routes, available from sign-in without an account. They complement the real portal; they do not replace authentication, server permissions or the account-specific welcome checklist.

## Deutsch

- **Demo mit Beispieldaten ausprobieren** auf der Anmeldung öffnet `/demo`. Alle 25 Modulbereiche sind über die Demo-Navigation erreichbar. `/demo/jobs` öffnet zum Beispiel die Auftragsübung; `/demo?module=jobs` ist ebenfalls möglich.
- Die Demo kennzeichnet ihre fiktiven Inhalte dauerhaft. Übe eine vollständige mehrtägige Übernahme, abgelehnte Übernahmen, Kalender, Chat, Profil, Dokumentprüfung und Rechnungsschritte. Alle Ergebnisse sind Simulationen. Es gibt keine echten Buchungen, Uploads, Nachrichten, Einladungen oder Unterschriften.
- **Geführter Rundgang** erklärt die Bereiche nacheinander. Vor/Zurück, Pausieren und Neustart erlauben eigenes Tempo. Du kannst währenddessen Deutsch/Englisch und die Darstellung wechseln. Die Demo-Rolle erklärt eine Perspektive und erteilt keine Portalrechte.
- **Demo zurücksetzen** verwirft die Übungseingaben. Auch ein Neuladen oder das Verlassen der Demo verwirft sie. Gib keine echten Namen, Kundendaten, Geheimnisse oder Dokumentinhalte in Übungen ein. Sprache und Darstellung bleiben als normale Oberflächenpräferenzen erhalten.
- **Portal-Rundgang** im angemeldeten Portal führt auf ausdrücklichen Klick zu den für dein Konto verfügbaren Bereichen. Er erklärt die nächsten Schritte und führt keine Geschäftsaktion aus. Alle echten Aktionen behalten ihre normalen Prüfungen und Serverbestätigungen. Nutze die Demo, wenn du gefahrlos ausprobieren möchtest.
- Der Portal-Rundgang speichert ausschließlich Schritt und Status im Sitzungsspeicher dieses Browsers, getrennt nach Konto. Pausieren/Fortsetzen funktioniert über Seitenwechsel und Neuladen derselben Browsersitzung. Das ist kein kontenübergreifend synchronisierter Lernnachweis. Bei gesperrtem Sitzungsspeicher funktioniert er im Arbeitsspeicher weiter.
- **Hilfe & Anleitungen** unter `/help` enthält durchsuchbare Schrittfolgen, häufige Probleme und Lösungen in beiden Sprachen. `/help?topic=files` öffnet gezielt die Dateihilfe. `/help?topic=troubleshooting` erklärt Verbindung, fehlende Berechtigungen, unbestätigte Aktionen und sichere Problemmeldungen. Allgemeine Fehleranzeigen verlinken dorthin.

## English

Choose **Try the sample-data demo** at sign-in to open `/demo`. All 25 module areas are available through demo navigation and a guided sequence. Try full multi-day claims, rejection scenarios, calendar, chat, profile, document scanning and invoice steps using fictional data. Every result is simulated. No action books real work, uploads files, sends messages or emails, or signs an agreement. The demo role changes the educational perspective only.

Use previous/next, pause and restart at your own pace. Switching language/theme keeps the current exercise. Resetting, reloading or leaving the demo discards exercise input. Never enter real personal/customer data or secrets. Ordinary language/theme preferences remain separate.

The authenticated **Portal tour** navigates only after your explicit choice and uses current account roles/permissions to select relevant destinations. It explains real workflows without executing business actions. Real controls still require their normal online server confirmation. Only the tour step/status is kept in browser session storage per account; storage denial falls back to in-memory operation. This is not a server-synchronised completion record.

Open **Help & guides** at `/help` for searchable instructions and practical recovery steps. Deep links such as `/help?topic=jobs` select a module; `/help?topic=troubleshooting` opens general recovery advice. Interface instructions are authored in German and English; real authored customer/course content is never translated by this feature.

## Implementation and operating boundary

- `src/features/help/catalog.ts` owns bilingual instructions for actual portal modules. Changes to live workflows should update that catalogue and tests together.
- Demo components import no Supabase/API client and hold exercise inputs only in React memory. Public help contains authored documentation only. An existing signed-in session may still undergo the application's ordinary global Auth refresh; this is independent of demo actions.
- The live tour is presentation/navigation only. It never grants permissions, imitates a real session, invokes mutation APIs or confirms a real claim. Administrative and commercial stops follow the current shell's role/permission predicates; both permissions remain necessary for qualification administration.
- Public routes expose no private records. Existing PostgreSQL, Storage, Auth, MFA and API policies are unchanged. No database migration, new dependency, service registration or hosting configuration is required.
- Public help and fictional demo application code can be included in the existing PWA shell cache. Exercise input and private records are not added to a cache or browser storage.
- This PR does not certify every remaining master-specification feature or deploy to production. The usual successful CI release gates still apply to authorised development updates.

## Verification

`npm test`, `npm run test:coverage`, `npm run typecheck`, `npm run lint`, `npm run format:check` and `node scripts/code-integrity.mjs --exports` cover source quality and regression checks. `npx playwright test --config scripts/guided-demo-playwright.config.ts` runs public desktop/mobile browser checks against a separate frontend with synthetic configuration, without a database. It aborts and fails attempted backend calls in fresh public sessions. The same browser specification also runs inside the ordinary complete `./portal test` CI workflow, which separately verifies real authenticated business behavior and retained data. Actual outcomes are recorded in WORKLOG; this command list is not itself a pass record.

Follow-up functional/dead-code review and concrete regression evidence: [GUIDED_EXPERIENCE_AUDIT](GUIDED_EXPERIENCE_AUDIT.md).
