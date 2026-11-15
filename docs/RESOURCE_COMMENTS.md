# Kommentare an Vorlagen und Aufträgen

`ResourceComments({kind: "template" | "job", resourceId})` zeigt einen ressourcenbezogenen Lehrteam-Austausch. Aufträge verwenden dieselbe `private.can_read_job`-Prüfung wie die Job-RLS; Vorlagen brauchen ihre tatsächliche Leseberechtigung und Lehrteam-/Managementrolle. Auftraggeber und Kursteilnehmende erhalten durch Kurs-/Rechnungszugriff keine Lehrteam-Diskussion. Admin/Owner behalten die üblichen Rollen/MFA- und Ressourcenregeln.

Die Datensätze und früheren Textfassungen liegen in nicht exponierten privaten Tabellen mit RLS und ohne direkte Benutzergrants. Autor und Zeitstempel kommen vom Server. Die UI rendert reinen Text einschließlich Zeilenumbrüchen und maskiertem HTML. Kommentare enthalten keine automatisch übernommenen Gesamtpreise und ändern keine angenommenen Auftragsbedingungen.

## API

| RPC                                                                   | Verhalten                                                                                                                                                       |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `comment_context(p_kind,p_id)`                                        | Aktuelle Schreib-/Moderationsmöglichkeiten; keine Zeilen bei fehlender Berechtigung.                                                                            |
| `resource_comments(p_kind,p_id,p_before_at,p_before_id,p_limit)`      | Neueste zuerst, kompletter Zeit/UUID-Cursor, maximal 100 Zeilen. Ausgeblendete Beiträge sehen nur Verfasser und berechtigte Moderation.                         |
| `add_resource_comment(p_kind,p_id,p_body,p_request_id)`               | 1–5000 Zeichen, echte Actor-Identität, dauerhafte ressourcengebundene Wiederholung mit derselben UUID; höchstens 10 neue Beiträge/Minute und 100/Tag pro Actor. |
| `edit_resource_comment(p_comment_id,p_body,p_version)`                | Nur eigene zugängliche Beiträge mit geprüfter Version; keine stille Überschreibung, Autoränderung oder aufgehobene Moderation.                                  |
| `withdraw_resource_comment(p_comment_id,p_version)`                   | Eigener Rückzug entfernt den Text aus normalen Leseprojektionen; Rückzugshinweis und geschützte Historie bleiben.                                               |
| `moderate_resource_comment(p_comment_id,p_hidden,p_reason,p_version)` | Aktuelle Management-Capability des Ressourcentyps und MFA; Grund erforderlich; aktuelle Version erforderlich; Audit.                                            |

Archivierte Einträge bleiben für berechtigte Personen lesbar, schließen neue Beiträge/Änderungen und erlauben weiterhin eigenen Rückzug. Versteckte Entwürfe und entfallene Rollen/Sperren werden bei jedem Serveraufruf neu geprüft. Bereits gelesener Text kann nicht nachträglich aus dem Gedächtnis eines Empfängers entfernt werden; neue Abrufe bleiben geschützt.

Fehlercodes: `42501` für fehlende Rechte, `22023` für ungültigen Text/Cursor oder geänderte Wiederholung, `40001` für einen Versionskonflikt, `54000` für die Beitragsgrenze. Ein unsicherer Netzwerkversuch behält dieselbe Request-ID, solange der Entwurf unverändert bleibt. Offline oder während einer laufenden Mutation wird keine Veröffentlichung vorgetäuscht.

## Implementierung und Prüfung

Migration `20261115155038_resource_comments.sql`; Frontend `src/features/comments`; echte SQL-/API-Skripte `comments-db-tests.mjs` / `comments-api-check.mjs`; Playwright `comments.spec.ts`. Der geteilte API-Fixture-Helfer und `defer`-Aufräumvertrag sind im [Entwicklerhandbuch](DEVELOPER_GUIDE.md) erklärt.

Bestanden im vollständigen lokalen M4-03-Lauf: elf reale temporäre PostgreSQL-Prüfungen für Grenzen, zehn gleichzeitige identische Schreibversuche/einen Datensatz, Cursor, Autor-/Moderationsversionen, Rückzug, Rollenentzug und Sperre; drei Komponentenprüfungen für Zugriffsgate, getrennte Entwürfe und unsichere Wiederholung/Serverbestätigung; echte Auth-/TOTP-/RPC-Aufrufe und getrennte Desktop-/Mobil-Browserabläufe für Schreiben, Neuladen, Bearbeiten, Moderieren und Zurückziehen. Die zusätzliche Abnahme nach Zusammenführung mit dem Hosting-Code wird in [QA_RESULTS](QA_RESULTS.md) und [WORKLOG](WORKLOG.md) getrennt dokumentiert. Die private Historie ist keine fertig beschlossene gesetzliche Aufbewahrungs-/Löschregel.
