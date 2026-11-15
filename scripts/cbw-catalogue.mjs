import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const cataloguePath = new URL(
  "../data/cbw-building-blocks.json",
  import.meta.url,
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
export function stableCatalogueId(value) {
  const hex = hash(`luminovia-cbw:${value}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const isoDate = (value) => value.split(".").reverse().join("-");
const tidy = (value) => value.replace(/\s+/g, " ").trim();

// Only the curriculum section is imported. Names, book prices, ISBNs and room
// preparation are not course content, and page furniture is not a syllabus item.
export function extractBuildingBlock(text, fileName, sha256) {
  const code = /Kurzzeichen:\s*([A-Z0-9]+)/.exec(text)?.[1];
  const title = tidy(
    text.split("Bausteinbezeichnung:")[1]?.split("Erstellt am:")[0] ?? "",
  );
  const duration = /Bausteindauer\s+(\d+)\s*Tage,\s*(\d+)\s*Std\./.exec(text);
  const contentStart =
    text.indexOf("Bausteininhalt:") + "Bausteininhalt:".length;
  const contentEnd = [
    text.indexOf("Als Dozent", contentStart),
    text.indexOf("Theorie/Praxis:", contentStart),
  ]
    .filter((value) => value >= 0)
    .sort((a, b) => a - b)[0];
  if (
    !code ||
    !title ||
    !duration ||
    contentStart < "Bausteininhalt:".length ||
    !contentEnd ||
    !/^[a-f0-9]{64}$/.test(sha256)
  )
    throw new Error(`Unrecognised building-block structure: ${fileName}`);
  const raw = text.slice(contentStart, contentEnd);
  const paragraphs = raw
    .replaceAll("\f", "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => {
      const lines = paragraph
        .split("\n")
        .map(tidy)
        .filter(
          (line) =>
            line &&
            !/^\d{2}\.\d{2}\.\d{4}\s+\d+$/.test(line) &&
            !/^Beratung\s*[|·]/.test(line),
        );
      const result = [];
      for (const line of lines) {
        const bullet = /^-{1,2}\s*/.test(line) || /^\d+\./.test(line);
        const cleaned = line.replace(/^-{1,2}\s*/, "- ");
        if (result.at(-1) === cleaned) continue;
        if (!bullet && result.at(-1)?.startsWith("- "))
          result[result.length - 1] += " " + cleaned;
        else result.push(cleaned);
      }
      return result.join("\n");
    })
    .filter(Boolean);
  const syllabus = paragraphs.join("\n\n").trim();
  const dates = [...text.matchAll(/\d{2}\.\d{2}\.\d{4}/g)].map((match) =>
    isoDate(match[0]),
  );
  const ratio = /Theorie\/Praxis:\s*(\d+)\s*:\s*(\d+)/.exec(text);
  const firstPage = text.slice(0, contentStart).split("\f").length;
  const lastPage = text.slice(0, contentEnd).split("\f").length;
  return {
    code,
    title,
    syllabus,
    duration_days: Number(duration[1]),
    duration_hours: Number(duration[2]),
    theory_percent: ratio ? Number(ratio[1]) : null,
    practice_percent: ratio ? Number(ratio[2]) : null,
    source: {
      id: stableCatalogueId(`source:${fileName}:${sha256}`),
      file_name: fileName,
      sha256,
      page_count: text.split("\f").length - (text.endsWith("\f") ? 1 : 0),
      content_pages: Array.from(
        { length: lastPage - firstPage + 1 },
        (_, i) => firstPage + i,
      ),
      created_on: dates[0],
      revision_on: dates.at(-1),
      is_primary: false,
    },
  };
}

export function buildCatalogue(files) {
  const grouped = new Map();
  for (const input of [...files].sort((a, b) =>
    a.file_name.localeCompare(b.file_name, "de"),
  )) {
    const row = extractBuildingBlock(input.text, input.file_name, input.sha256);
    const existing = grouped.get(row.code);
    if (existing) {
      // A filename alias is accepted only when its actual educational content
      // agrees. Different PDFs are retained as distinct byte-hashed sources.
      if (
        existing.title !== row.title ||
        existing.syllabus !== row.syllabus ||
        existing.duration_days !== row.duration_days ||
        existing.duration_hours !== row.duration_hours
      )
        throw new Error(
          `Conflicting sources for ${row.code}; manual version review required`,
        );
      existing.sources.push(row.source);
      continue;
    }
    const { source, ...content } = row;
    const linuxContinuation = ["LPC3", "LPC4"].includes(row.code);
    grouped.set(row.code, {
      id: stableCatalogueId(`block:${row.code}`),
      provider: "CBW",
      ...content,
      description: `CBW-Baustein ${row.code}: ${row.title}. Dauer laut Bausteinbeschreibung: ${row.duration_days} Tage, ${row.duration_hours} Std.`,
      prerequisites: linuxContinuation
        ? "Die Inhalte der LPIC-1-Prüfung 101-500 wurden bereits absolviert. LPC3 und LPC4 bereiten gemeinsam auf die Prüfung 102-500 vor; LPC4 schließt an LPC3 an."
        : "",
      notes: linuxContinuation
        ? "LPC3/LPC4 sind die CBW-Bausteinnamen gemäß Kurzzeichen im Quelldokument. Die Dateinamen LPIC3/LPIC4 enthalten dieselben Bausteininhalte in einer neueren Layoutfassung. Die Einordnung nach bereits absolvierter 101-500 folgt Carinas Projektvorgabe. Historische Titel und Inhalte bleiben als Quelle erkennbar."
        : "Historischer Bausteininhalt gemäß referenziertem Quelldokument. Genannte Prüfungskennungen sind keine Bestätigung aktueller Zertifizierungsanforderungen.",
      default_template_id: stableCatalogueId(`template:${row.code}`),
      sources: [source],
    });
  }
  const blocks = [...grouped.values()].sort((a, b) =>
    a.code.localeCompare(b.code, "de"),
  );
  for (const block of blocks) {
    block.sources.sort(
      (a, b) =>
        b.revision_on.localeCompare(a.revision_on) ||
        a.file_name.localeCompare(b.file_name, "de"),
    );
    block.sources[0].is_primary = true;
  }
  return {
    schema_version: 1,
    provider: "CBW",
    source_count: files.length,
    blocks,
  };
}

export function renderCatalogueSql(catalogue) {
  const json = JSON.stringify(catalogue);
  // Both levels quote generated SQL: source data must not close either the
  // inner JSON literal or the surrounding DO body, even in a future PDF.
  if (
    ["$cbw_catalogue$", "$cbw_import$"].some((marker) => json.includes(marker))
  )
    throw new Error(
      "SQL delimiter occurs in source; choose a reviewed alternative delimiter",
    );
  return `-- BEGIN GENERATED CBW CATALOGUE\n-- Regenerate from reviewed source metadata with scripts/cbw-catalogue.mjs --sql.\ndo $cbw_import$\ndeclare catalogue jsonb := $cbw_catalogue$${json}$cbw_catalogue$::jsonb; block jsonb; source jsonb; primary_source uuid;\nbegin\n for block in select value from jsonb_array_elements(catalogue->'blocks') loop\n  insert into public.building_blocks(id,provider,code,title,description,syllabus,prerequisites,duration_days,duration_hours,theory_percent,practice_percent,notes) values((block->>'id')::uuid,block->>'provider',block->>'code',block->>'title',block->>'description',block->>'syllabus',block->>'prerequisites',(block->>'duration_days')::integer,(block->>'duration_hours')::numeric,(block->>'theory_percent')::integer,(block->>'practice_percent')::integer,block->>'notes') on conflict(id) do nothing;\n  for source in select value from jsonb_array_elements(block->'sources') loop\n   insert into public.building_block_sources(id,building_block_id,file_name,sha256,page_count,content_pages,created_on,revision_on,is_primary) values((source->>'id')::uuid,(block->>'id')::uuid,source->>'file_name',source->>'sha256',(source->>'page_count')::integer,array(select value::integer from jsonb_array_elements_text(source->'content_pages')),(source->>'created_on')::date,(source->>'revision_on')::date,(source->>'is_primary')::boolean) on conflict(id) do nothing;\n  end loop;\n  select id into primary_source from public.building_block_sources where building_block_id=(block->>'id')::uuid and is_primary;\n  insert into public.course_templates(id,title,description,syllabus,prerequisites,building_block_id,building_block_source_id) values((block->>'default_template_id')::uuid,'CBW '||(block->>'code')||' · '||(block->>'title'),block->>'description',block->>'syllabus',block->>'prerequisites',(block->>'id')::uuid,primary_source) on conflict(id) do nothing;\n  update public.building_blocks set default_template_id=(block->>'default_template_id')::uuid where id=(block->>'id')::uuid and default_template_id is null;\n end loop;\nend;$cbw_import$;\n-- END GENERATED CBW CATALOGUE`;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.includes("--source-dir")) {
    const folder = args[args.indexOf("--source-dir") + 1];
    if (!folder) throw new Error("--source-dir requires a local directory");
    const files = readdirSync(folder)
      .filter((name) => name.toLowerCase().endsWith(".pdf"))
      .sort()
      .map((file_name) => ({
        file_name: basename(file_name),
        sha256: hash(readFileSync(resolve(folder, file_name))),
        text: execFileSync(
          "pdftotext",
          ["-layout", resolve(folder, file_name), "-"],
          { encoding: "utf8" },
        ),
      }));
    const catalogue = buildCatalogue(files);
    if (args.includes("--write"))
      writeFileSync(cataloguePath, JSON.stringify(catalogue, null, 2) + "\n");
    else if (
      JSON.stringify(catalogue) !==
      JSON.stringify(JSON.parse(readFileSync(cataloguePath, "utf8")))
    )
      throw new Error(
        "Source catalogue differs; inspect before --write and an additive migration",
      );
    console.log(
      `Verified ${catalogue.source_count} PDF source versions / ${catalogue.blocks.length} distinct CBW building blocks.`,
    );
  } else {
    const catalogue = JSON.parse(readFileSync(cataloguePath, "utf8"));
    if (args.includes("--sql"))
      process.stdout.write(renderCatalogueSql(catalogue) + "\n");
    else
      console.log(
        `${catalogue.source_count} source versions / ${catalogue.blocks.length} CBW building blocks. Use --source-dir <local-folder> to verify the originals; --write explicitly updates the reviewed catalogue.`,
      );
  }
}
