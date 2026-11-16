/**
 * Regressionen für CBW-Extraktion, Quellenhashes und deterministische Katalogidentitäten.
 * Fiktive Dokumenttexte prüfen den Importvertrag ohne persönliche Originalunterlagen.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCatalogue,
  cataloguePath,
  extractBuildingBlock,
  renderCatalogueSql,
} from "./cbw-catalogue.mjs";

const catalogue = JSON.parse(readFileSync(cataloguePath, "utf8"));
/** Erzeugt fiktiven PDF-Extraktionstext mit steuerbarem Kurzzeichen, Lehrplan und Revisionsdatum; private Randangaben dürfen nicht im Katalog landen. */
const fixture = (
  code = "LPC3",
  syllabus = "- Shell-Umgebung\n- Skripte\n",
  revision = "09.09.2026",
) =>
  `Formblatt\nKurzzeichen: ${code} Fachgebiet NW\nBausteinbezeichnung: Linux course\nErstellt am: 09.12.2022\nAutor: Private source author\nBausteindauer 10 Tage, 80 Std.\nBausteininhalt: ${syllabus}\nAls Dozent/-in freely designed\nTheorie/Praxis: 40:60\nAusstattung: Not curriculum\n\n${revision} 1\f`;
test("CBW catalogue covers 24 source versions, 22 real codes and exact primary aliases", () => {
  assert.equal(catalogue.source_count, 24);
  assert.equal(catalogue.blocks.length, 22);
  assert.equal(
    catalogue.blocks.reduce((count, row) => count + row.sources.length, 0),
    24,
  );
  const allIds = catalogue.blocks.flatMap((row) => [
    row.id,
    row.default_template_id,
    ...row.sources.map((source) => source.id),
  ]);
  assert.equal(new Set(allIds).size, allIds.length);
  for (const row of catalogue.blocks) {
    assert.equal(row.sources.filter((source) => source.is_primary).length, 1);
    assert.equal(row.duration_days, 10);
    assert.equal(row.duration_hours, 80);
    for (const source of row.sources) {
      assert.match(source.sha256, /^[a-f0-9]{64}$/);
      assert.ok(
        source.content_pages.every(
          (page) => page > 0 && page <= source.page_count,
        ),
      );
    }
  }
  for (const code of ["LPC3", "LPC4"]) {
    const row = catalogue.blocks.find((row) => row.code === code);
    assert.equal(row.sources.length, 2);
    assert.equal(
      row.sources.find((source) => source.is_primary).file_name,
      `Bausteinbeschreibung-LPIC${code.at(-1)}.pdf`,
    );
    assert.match(row.prerequisites, /101-500/);
    assert.match(row.prerequisites, /102-500/);
  }
  assert.equal(
    catalogue.blocks.some((row) => row.code === "CIS1"),
    false,
    "Missing original is not fabricated",
  );
});
test("Only approved curriculum text and provenance enter the committed migration", () => {
  const extracted = extractBuildingBlock(
    fixture(),
    "source.pdf",
    "a".repeat(64),
  );
  assert.equal(extracted.syllabus, "- Shell-Umgebung\n- Skripte");
  assert.equal(extracted.source.revision_on, "2026-09-09");
  assert.ok(!JSON.stringify(extracted).includes("Private source author"));
  assert.ok(!JSON.stringify(extracted).includes("Not curriculum"));
  assert.ok(!JSON.stringify(catalogue).includes("/home/"));
});
test("Alias dedupe compares actual syllabus and rejects conflicting definitions", () => {
  const inputs = [
    {
      file_name: "old.pdf",
      text: fixture("LPC3", undefined, "05.09.2025"),
      sha256: "a".repeat(64),
    },
    { file_name: "new.pdf", text: fixture(), sha256: "b".repeat(64) },
  ];
  const merged = buildCatalogue(inputs);
  assert.equal(merged.blocks.length, 1);
  assert.equal(merged.blocks[0].sources.length, 2);
  assert.equal(merged.blocks[0].sources[0].file_name, "new.pdf");
  assert.throws(
    () =>
      buildCatalogue([
        ...inputs,
        {
          file_name: "conflict.pdf",
          text: fixture("LPC3", "- Different actual curriculum"),
          sha256: "c".repeat(64),
        },
      ]),
    /Conflicting sources/,
  );
});
test("Reviewed catalogue and the immutable generated migration data stay reproducible", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261115155208_cbw_building_block_templates.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const embedded = migration.slice(
    migration.indexOf("-- BEGIN GENERATED CBW CATALOGUE"),
    migration.indexOf("-- END GENERATED CBW CATALOGUE") +
      "-- END GENERATED CBW CATALOGUE".length,
  );
  assert.equal(embedded, renderCatalogueSql(catalogue));
  assert.throws(
    () =>
      extractBuildingBlock(
        "Malformed scanned source",
        "bad.pdf",
        "a".repeat(64),
      ),
    /Unrecognised/,
  );
});
test("SQL generation rejects either nested dollar delimiter in future source content", () => {
  for (const delimiter of ["$cbw_catalogue$", "$cbw_import$"])
    assert.throws(
      () =>
        renderCatalogueSql({ ...catalogue, untrusted_future_note: delimiter }),
      /SQL delimiter occurs in source/,
    );
});
