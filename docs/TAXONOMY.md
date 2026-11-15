# Gemeinsamer Themen- und Werkzeugkatalog

Der Katalog unter `/topics` verbindet dieselben Themenkennungen mit Profilkenntnissen, Kursvorlagen und Auftragsanforderungen. Die drei Arten sind Thema, Tool und Programmiersprache; gesprochene Profilsprachen bleiben ein eigenes Feld. Einträge haben deutsche und englische Bezeichnungen und Beschreibungen, bis zu 20 Suchaliassen und einen optionalen übergeordneten Eintrag. Verwandte Kursvorlagen erscheinen ausschließlich, wenn das aktuelle Konto sie tatsächlich lesen darf; die Links öffnen die bestehende Vorlagendetailansicht.

Aktive angemeldete Konten können suchen und lesen. Die Suche umfasst beide Bezeichnungen und Aliasse, behandelt Suchzeichen wörtlich und liefert höchstens 500 Einträge. Die Oberfläche wartet 200 ms nach einer Texteingabe und bricht überholte Anfragen ab. Aktorbezogene Query-Schlüssel verhindern die Übernahme des Katalog-Caches eines anderen Kontos. Ungefilterte Liste und Elternauswahl teilen dieselbe Anfrage.

## Verwaltung und Historie

`taxonomy.manage` wird bestehenden Rollen `owner`, `admin` und `management` zugeordnet. Änderungen benötigen diese aktuelle Datenbankberechtigung und bestätigte MFA (`aal2`). Browserrollen und editierbare Auth-Metadaten sind keine Autorisierung. Direkte Schreibrechte auf `topics` erhält auch ein MFA-Administrator nicht.

Erstellen und Bearbeiten verwenden die vollständigen Formulardaten. Änderungen und Archivwechsel prüfen die beobachtete Versionsnummer; eine veraltete Bearbeitung überschreibt keine neueren Angaben. Bei einem Konflikt bleibt der Formularentwurf sichtbar. Die bewusste Aktion „Aktuellen Stand laden“ lädt Daten neu und schließt den Entwurf; anschließend lässt sich die aktuelle Fassung öffnen. Ein Fehler oder eine ausstehende Anfrage wird nicht als erfolgreiche Speicherung angezeigt.

Ein globaler kurzer Schreiblock auf dem kleinen Katalog verhindert, dass zwei gleichzeitig gültig erscheinende Elternverschiebungen zusammen einen Zyklus erzeugen. Selbstbezüge und Nachfahren als Eltern werden abgelehnt. Die Migration prüft vorhandene Hierarchien und bricht bei alten Zyklen atomar ab; sie schreibt keine historischen Beziehungen um.

Archivieren bewahrt die Kennung, bestehende Kurs-/Auftragsverknüpfungen und vorhandene Kenntnisse samt Verifizierungsstatus und Ablaufdatum. Aktive Untereinträge müssen zuerst archiviert werden. Neue Zuordnungen eines archivierten Eintrags sind am Datenbankrand für Profilkenntnisse, Kursvorlagen und Aufträge gesperrt. Die Wiederherstellung verlangt einen aktiven Elternknoten. Archivierung ist keine Vertraulichkeitsstufe: Bestehende Referenzen dürfen ihre Bezeichnung weiterhin anzeigen.

## API und Prüfungen

Die öffentlichen Funktionen sind reine Invoker-Einstiege in eingeschränkte private Funktionen mit leerem Suchpfad und expliziten Ausführungsrechten:

- `taxonomy_catalogue(p_search, p_kind, p_include_archived)` liefert Katalogeinträge und erlaubte Kursvorlagen. Archivierte Suchergebnisse erfordern die Verwaltungsberechtigung.
- `save_taxonomy_topic(p_id, p_payload, p_version)` erstellt mit `p_id = null` und Version `0` oder aktualisiert eine beobachtete aktive Fassung.
- `set_taxonomy_topic_archived(p_id, p_archived, p_version)` archiviert oder stellt eine beobachtete Fassung wieder her.

Die Quellen liegen in `src/features/taxonomy/` und der additiven Migration `20261115203718_taxonomy_catalogue_management.sql`. Bestehende Migrationen werden nicht ersetzt. Bedeutung und Umfang der Datenbankrechte stehen in [ARCHITECTURE](ARCHITECTURE.md).

Gezielte Prüfungen:

```bash
npx vitest run src/features/taxonomy
PORTAL_DB_CONTAINER=supabase_db_luminovia-portal-test-m6 node scripts/taxonomy-db-tests.mjs
```

Die SQL-Prüfung erstellt und entfernt ausschließlich eigene temporäre Datenbanken im lokalen Testcontainer. Zehn reale PostgreSQL-Prüfgruppen decken MFA/Rollen, strukturierte Validierung, wörtliche Suche, gegensätzliche gleichzeitige Elternänderungen, Kurs-/Teilnehmerzugriffe und Entzug, alte Qualifikationen, veraltete Versionen, alle drei Archiv-Zuordnungsgrenzen und den atomaren Abbruch bei ungültiger Altstruktur ab. Die ursprüngliche Namensauflösung beim UPDATE wurde durch einen tatsächlich fehlgeschlagenen Test gefunden und korrigiert; die Abnahmetests bestehen erst danach.

`scripts/taxonomy-api-check.mjs` ergänzt tatsächliche Auth-, TOTP- und REST-Prüfungen im ausdrücklich isolierten Gesamtprojekt. `tests/e2e/taxonomy.spec.ts` enthält reale Desktop-/Mobil-Journeys mit DE/EN-Entwurfserhalt, Archiv/Wiederherstellung, Lesekonto, Offlinezustand und axe. Diese Prüfungen dürfen nur über den isolierten Gesamtbefehl laufen. Ein verfasster Browser-/API-Test allein ist kein bestandener Lauf; der tatsächliche Abnahmestand steht in [QA_RESULTS](QA_RESULTS.md) und [WORKLOG](WORKLOG.md).
