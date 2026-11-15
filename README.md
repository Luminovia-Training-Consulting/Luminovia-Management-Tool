# Luminovia Portal

A real React/TypeScript Progressive Web App for Luminovia Training & Consulting. The local system connects invitation-only Supabase Auth, administrator MFA, bilingual profiles/evidence, teaching jobs and atomic allocation, calendar, private realtime chat, scanned files, wiki/forum, customers/courses and contract/invoice tracking. Individual client accounts, optional enrolled learners, safe course ratings, profile/invoice labels and a server-enforced default 50/50 commission model extend these workflows. CBW building blocks become provenance-linked course templates and referenced teaching offers; secure scanned profile pictures and staff comments connect the same application. It is **not the complete production product yet**. See the [implementation plan](docs/IMPLEMENTATION_PLAN.md) for the entire outstanding scope.

The user's [Universal Master Prompt](docs/UNIVERSAL_MASTER_PROMPT.txt) is preserved verbatim and is the authoritative project specification. On continuation, read [WORKLOG](docs/WORKLOG.md) first, then [AGENTS.md](AGENTS.md) and the plan. The public Website repository is a read-only brand reference; it has not been changed.

## Requirements

- Linux (CachyOS locally, Ubuntu in CI), Node.js 26 LTS (tested with 26.13.1), npm, Docker Engine and the Docker Compose plugin supporting [healthcheck `start_interval`](https://docs.docker.com/reference/compose-file/services/#healthcheck) (Compose 2.20.2 or later). Python 3, Linux util-linux `flock` and official `age`/`age-keygen` 1.x (tested 1.3.2) are additionally required by the complete local release/update verification.
- Loopback ports 5173, 54321, 54322 and 54324 available. Local Docker services require several GB of disk space.
- Supabase CLI 3.1.0 and Deno 2.9.6 are pinned development dependencies; inspect their `--help` before database/remote operations.

## Lokal mit einem Befehl starten

```bash
./portal start
```

Der Befehl installiert bei Bedarf die gesperrten npm-Abhängigkeiten und startet das vollständige lokale System: PostgreSQL, Supabase Auth/Storage/Realtime, Edge Functions, Malware-Scanner, Mailpit und React/Vite. Neue Migrationen werden ohne Daten-Reset angewendet. Fiktive Beispieldaten werden nur bei der ersten leeren Initialisierung erzeugt.

Öffne <http://127.0.0.1:5173>. Lokale E-Mails werden ausschließlich in [Mailpit](http://127.0.0.1:54324) abgefangen. Bei einer neuen, leeren Initialisierung heißen die elf fiktiven Dozierenden `lecturer01@example.invalid` bis `lecturer11@example.invalid`; zusätzlich gibt es `admin@example.invalid`, `participant@example.invalid`, `carina@example.invalid` (Plattformleitungs-Demo) und `client@example.invalid` (Auftraggeber-Demo). Das sind getrennte fiktive Auth-Konten; echte Einladungen vergeben eigene Passwörter.

```bash
./portal credentials   # ursprüngliches lokales Testpasswort bewusst anzeigen
./portal status        # Dienststatus und URLs
./portal stop          # datenerhaltend stoppen
./portal restart       # datenerhaltend neu starten
```

Passwörter, MFA, Profiländerungen, Verifizierungen, Sperren, Aufträge, Kalender und tatsächliche Storage-Dateien bleiben bei Stop/Start erhalten. Der normale Start setzt keine Profile oder Passwörter zurück. Zugangsdaten stehen in der geschützten, ignorierten `.local/ACCOUNTS.txt`; Server-Schlüssel gelangen weder in Git noch in das Browser-Bundle. Admins richten MFA im echten Sicherheitsdialog ein.

`./portal up` bleibt im Terminal; Ctrl+C stoppt die Dienste datenerhaltend. Der Hintergrundstart bleibt bis `./portal stop` aktiv. Der erste Start benötigt Image-Downloads und Scanner-Signaturinitialisierung. Der Scanner ist auf 4GB RAM begrenzt; paralleler Entwicklungs- und Testbetrieb benötigt Speicher für zwei getrennte lokale Stacks.

Die vollständigen Betriebsdetails, Fehlerbehebung und Persistenzgrenzen stehen in [LOCAL_DEVELOPMENT](docs/LOCAL_DEVELOPMENT.md). Ein Docker-Volume ist dauerhafte lokale Speicherung, jedoch kein externes Backup.

## Implemented routes

| Route                    | Function                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `/login`                 | Real email/password sign-in and password recovery; no public signup.                                                                |
| `/auth/callback`         | Explicit one-time invitation acceptance; PKCE recovery callback.                                                                    |
| `/auth/password`         | Set a password after an authenticated invite/recovery.                                                                              |
| `/`                      | Real open jobs, personal assignment counts and upcoming sessions.                                                                   |
| `/jobs`, `/jobs/:id`     | Combined filters, localised sessions/fees, exact-version terms acceptance and atomic allocation.                                    |
| `/calendar`              | Private appointments, confirmed assignments, published global events and month/week/day/agenda views.                               |
| `/profile`               | Persisted DE/EN biography, contact/timezone, expertise and private CV/certificate uploads.                                          |
| `/chats`                 | Private DMs, staff/group and separate lecturer/participant course rooms; realtime messages, files, membership and read/mute state.  |
| `/files`                 | Quarantined/scanned private files, upload progress, authorised download/preview, history, replace, rename and archive.              |
| `/wiki`, `/forum`        | Safe rich text/code, drafts/publication/revisions; threads, replies, accepted answers, subscriptions and moderation.                |
| `/clients`               | MFA/capability-protected customer records, private contacts/notes, tags and archive.                                                |
| `/courses`               | Reusable templates, actual runs/sessions, safe duplication and explicit publication.                                                |
| `/contracts`             | Executed PDF versions/hashes, master/addendum chain, private downloads and receipt history. A receipt is not an e-signature.        |
| `/finance`               | Accepted-assignment earnings, scanned invoice PDFs, review, partial/full payments and authorised CSV with separate currencies.      |
| `/search`                | Permission-aware jobs, documents, messages, safe wiki/forum results and minimal chat contacts.                                      |
| `/security`              | Real Auth TOTP enrollment/challenge; administrative actions require AAL2 at the database.                                           |
| `/admin`                 | Atomic course/job creation, publication/archive, lecturer invitations.                                                              |
| `/people`, `/people/:id` | Safe lecturer directory, own labels/expertise, actual upcoming/current/past courses and authorised anonymised ratings.              |
| `/my-reviews`            | Optional learners review actual completed enrolled courses; management enrols and moderates with MFA.                               |
| `/client`                | Own-organisation course requests/full fee, commissioned spend and assigned lecturers.                                               |
| `/admin/accounts`        | Versioned account API-backed role assignment, separate invitations, scoped client memberships and linked profile/status management. |
| `/admin/people`          | Search people, attest declared expertise with UTC expiry, suspend/reactivate accounts with named confirmation.                      |

Single-slot jobs are supported in this milestone. Every session in a multi-day job is reserved in one PostgreSQL transaction. Qualification validity, executed-contract prerequisites, job/deadline/terms status and private/confirmed calendar conflicts are checked server-side. Accepted rates/currency/terms are immutable snapshots. Requests are idempotent and competing jobs for the same lecturer are serialised. Admins cannot read private calendar entries merely because they are admins.

German/English and light/dark/system preferences persist locally. Server data are held only in memory; the service worker caches static application assets only. Claims, messages, file operations and all other mutations require online server confirmation. The PWA provides an offline shell and explicit connection state; it does not pretend offline actions succeeded.

## Stack and layout

React + TypeScript + Vite, Tailwind v4, shadcn-style Radix/CVA primitives, Lucide, React Router, TanStack Query, React Hook Form/Zod, i18next and FullCalendar/Luxon. Supabase PostgreSQL/Auth/Edge Functions are the backend; no extra application server. Tiptap/lowlight provide safe wiki/forum editing; private Supabase Storage and an internal ClamAV service process uploads. Advanced administration and remaining product scope are recorded in the plan.

- `src/features/`: functional areas; `src/components/ui/`: reusable primitives; `src/lib/`: shared API/types/localisation/time handling.
- `supabase/migrations/`: relational schema, RLS, capability checks, locked claim/admin routines and audit.
- `supabase/functions/`: bounded audited invitations and authenticated document upload/download with actual ClamAV scanning.
- `supabase/templates/invite.html`: bilingual token-hash invitation template compatible with PKCE clients.
- `scripts/local-*`: isolated fictional setup and real HTTP checks; `scripts/db-*`: real PostgreSQL adversarial/concurrency tests.
- `tests/e2e/`: real Auth/API browser flows, accessibility and built-PWA tests.

Dependencies are exact-pinned with `package-lock.json`. All FullCalendar packages use matching version 6.1.22. Security overrides pin patched `glob` and `minimatch`; see [security checklist](docs/SECURITY_PRIVACY_CHECKLIST.md) for remaining build-tool advisories. Use `npm ci`, not an unreviewed blanket `audit fix --force`.

## Mit einem Befehl vollständig testen

```bash
./portal test
```

Der Befehl verwendet einen bereinigten temporären Checkout, einen zufälligen eigenen Supabase-Projektnamen und separate Ports/Volumes. Entwicklungsdaten und laufende Entwicklungskonten werden nicht zurückgesetzt oder von den Tests verändert. Er prüft Code/Typen/Formatierung/Abhängigkeiten, Edge Functions, reale SQL-/RLS-/Nebenläufigkeit, tatsächliche HTTP-/Einladungs-/Mailpit-Abläufe, Desktop/Mobilbrowser und die gebaute Offline-PWA. Eine echte Stop/Start-Prüfung vergleicht Passwort, MFA, Profil, privaten Termin und tatsächliche Storage-Objektbytes.

Berichte und geschützte Fehlerartefakte liegen unter `.local/tests/<run>/`. Nur der isolierte Teststack wird danach entfernt. Die einzelnen npm-/SQL-/API-Prüfungen bleiben für gezieltes Debugging vorhanden; führe mutierende Integrationsprüfungen innerhalb der isolierten Testumgebung aus. Neue Testskripte müssen die in [LOCAL_DEVELOPMENT](docs/LOCAL_DEVELOPMENT.md) beschriebenen URL-/Container-Variablen beachten.

Ausgeführte Ergebnisse und Grenzen werden in [QA_RESULTS](docs/QA_RESULTS.md) und [WORKLOG](docs/WORKLOG.md) festgehalten. Lokale Browser/PWA-Checks ersetzen keine physische iOS/Safari-Installation oder Prüfung des späteren Hosts. CI hat keine Produktivveröffentlichung.

## Staging and production

Die tatsächliche **selbst gehostete Entwicklungsinstanz** läuft unter **https://cms.luminovia.org** auf dem vorhandenen Hostinger **KVM 1**. Frontend, Supabase-Datenbank/Auth/Storage/Realtime/Edge und ClamAV liegen auf diesem VPS. Der Nutzer hat ein Upgrade ausdrücklich abgelehnt; ungefähr 100 GB Dokumente sind ein späteres Ausbauziel. Aktuell gelten 10 GiB Gesamt- und 1 GiB Besitzerkontingent. Test-E-Mails werden ausschließlich intern in Mailpit erfasst. [Einrichtung, geschützte Konfiguration, Tests und Betrieb](docs/HOSTINGER_DEVELOPMENT.md).

Der VPS prüft alle fünf Minuten auf erfolgreich getestete, unveränderliche GitHub-Versionen von `main`. Sicherungen, Migrationen, Laufzeitkonfiguration und atomare Web-Umschaltung gehören zum [automatischen Entwicklungsupdate](docs/HOSTINGER_AUTOMATIC_UPDATES.md); Serverzugangsdaten bleiben auf dem VPS. Größere/riskante Datenbankwechsel erfordern eine geprüfte Wartung. Ubuntu-Sicherheitsupdates sind automatisch aktiv.

Auf dem VPS läuft die fest gepinnte PostgreSQL 17.12-Version. Nach dem kontrollierten Patch bestanden erneut alle acht CMS-API-Prüfgruppen, 50 gleichzeitige Buchungsversuche mit genau einem vollständigen Gewinner, die unveränderte private Datei mit bestehendem Passwort sowie tatsächliche WSS-Zustellung und Rechteentzug. Eine externe Datenbank-plus-Datei-Sicherung wurde isoliert sowohl mit dem ursprünglichen Image als auch vorab mit dem 17.12-Kandidaten erfolgreich wiederhergestellt. Die [geprüften Pins und tatsächlichen Ergebnisse](deploy/hostinger/selfhost/postgres-upgrade-provenance.json) sind dokumentiert.

Caddy verwendet das stabile Verzeichnis `/opt/luminovia-portal/www`: `current` zeigt auf die aktive Frontend-Auslieferung, gemeinsam vorgehaltene unveränderliche Assets bleiben für bereits geöffnete Clients erreichbar. Daten und geheime Konfiguration liegen außerhalb dieses Webverzeichnisses.

Die folgenden Hinweise zum früher vorgesehenen verwalteten Backend sind keine Beschreibung dieser selbst gehosteten Instanz. Eine vollständige Produktivfreigabe mit echten Nutzern/SMTP, größerer Kapazität und wiederkehrender externer Sicherung bleibt gesondert erforderlich. Die öffentliche Marketing-Website wurde nicht geändert.

Use separate approved staging and production Supabase projects. Frontend build variables are `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` only. Never use server secret/service-role credentials in a `VITE_` variable. Disable signup, configure exact callback URLs, install the custom invitation template, configure approved SMTP, bootstrap the first admin through a controlled server process and require MFA. See [DEPLOYMENT_RUNBOOK](docs/DEPLOYMENT_RUNBOOK.md) for migration, invitation reconciliation, hosting headers, backups of **database plus Storage objects**, restore/rollback and release gates.

`public/.htaccess` is an un-deployed Apache/LiteSpeed reference template; the current VPS serves the portal through Caddy. Its SPA rewrite, no-referrer/CSP/security/cache headers must be tested on that actual host; adapt `connect-src` for an approved custom Supabase domain. Redact authentication query strings in hosting/access logs. A local Vite preview does not exercise Apache headers.

Stoppe verwaltete lokale Dienste mit `./portal stop`; Datenbank und tatsächliche Storage-Dateien bleiben erhalten. Verwende für Entwicklungsdaten kein `--no-backup`.

## Documentation

[System audit](docs/SYSTEM_AUDIT.md) · [Developer guide](docs/DEVELOPER_GUIDE.md) · [Functional audit](docs/FUNCTIONAL_CODE_AUDIT.md) · [CBW templates](docs/CBW_TEMPLATES.md) · [Profile pictures](docs/PROFILE_AVATARS.md) · [Comments](docs/RESOURCE_COMMENTS.md) · [Product scope](docs/PRODUCT_SPEC.md) · [Architecture](docs/ARCHITECTURE.md) · [ERD](docs/ERD.md) · [Brand](docs/BRAND_DESIGN_SYSTEM.md) · [Plan](docs/IMPLEMENTATION_PLAN.md) · [Security review](docs/BACKEND_SECURITY_REVIEW.md) · [Test plan](docs/TEST_PLAN.md) · [User guide](docs/USER_GUIDE.md)

Repository license: GNU GPLv3; the authentic Space Grotesk font retains its included OFL notice. Brand assets remain Luminovia assets.

## Account and revenue APIs

[Account/revenue specification](docs/ACCOUNTS_REVENUE_SPEC.md) · [Generated platform API reference](docs/API_REFERENCE.md) · [Server audit](docs/ACCOUNTS_PLATFORM_AUDIT.md).

New commission offers default to 50% platform / 50% lecturer; only admin/owner can change the percentage. Customer total and platform amounts remain in private tables and never appear in lecturer job/claim/invoice responses. Legacy accepted net fees stay unchanged, and unknown historical customer totals remain unknown. Income/payment status is tracking data; no bank transfer or tax calculation is initiated.

The account facade `/functions/v1/accounts/v1/` supports own profile, bounded administrative account search, roles, activation, organisation grants and idempotent invitations. Its OpenAPI is `/functions/v1/accounts/openapi.json`; all existing domain features remain accessible through the same JWT's documented Supabase RPCs and document gateway. Administrative actions require current database capabilities and MFA. New fixtures are insert-only and are created automatically only in an empty local bootstrap; existing populated instances are never silently reseeded.

## CBW building blocks and developer checks

All 24 original CBW PDFs in the supplied source folder are represented by 22 canonical building blocks and 24 hashed source revisions. LPC3/LPC4 retain both document variants; a source file is never silently dropped or duplicated as another course. The catalogue stores teaching content and exact filename/hash/page/date references, with original source authors and unrelated metadata excluded. Original PDF binaries and local personal paths are not published. New migrations install missing canonical templates without rewriting existing edited templates.

Use the CBW tab in Courses, plan an actual run with its customer/sessions, then choose **Create teaching offer**. Content and session references come from that run; the form reuses the standard fee/terms editor. The server rejects a changed source preview or duplicate active offer and preserves the accepted agreement. See [CBW_TEMPLATES](docs/CBW_TEMPLATES.md) for original-source verification and safe later editions.

```bash
node scripts/code-integrity.mjs --exports
./portal test
```

The compiler-based inventory detects disconnected frontend modules, genuinely unused runtime exports, unresolved relative imports, invalid literal routes/assets and transitive RPC wrappers. The complete command also checks delivered documentation links, real database/API bindings, Auth/MFA errors, actual desktop/mobile business journeys and the inherited offline updater/release/Caddy/Envoy guards. CI invokes this same command rather than a separate smaller local test subset. The [M4 migration review](docs/REVIEWED_M4_MIGRATIONS.md) describes the hosted operator gate; a merged source release does not assert those migrations are installed. These checks describe executed coverage; the outstanding complete product and hosted/manual gates remain in the plan.
