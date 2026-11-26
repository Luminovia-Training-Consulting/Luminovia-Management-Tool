/** Small, authored SCORM fixtures for the offline inspector and its browser test. */
import {
  TextReader,
  Uint8ArrayWriter,
  ZipWriter,
  type ZipWriterConstructorOptions,
} from "@zip.js/zip.js";

export const scormFixtureManifest =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<manifest xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:cp="http://www.adlnet.org/xsd/adlcp_rootv1p2" identifier="fictional">' +
  "<metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>" +
  '<organizations default="default"><organization identifier="default"><title>Fictional package</title>' +
  '<item identifier="lesson" identifierref="sco"><title>Exercise &lt;summary&gt;</title></item>' +
  "</organization></organizations>" +
  '<resources xml:base="course/"><resource identifier="sco" type="webcontent" href="learner%20page.html?mode=lesson" cp:scormtype="sco">' +
  '<file href="learner%20page.html"/><dependency identifierref="asset"/></resource>' +
  '<resource identifier="asset" type="webcontent" cp:scormtype="asset"><file href="example.css"/></resource></resources></manifest>';

/** A literal non-executing fixture whose entry text never becomes a DOM document. */
export async function scormFixtureZip(
  records: readonly (readonly [string, string])[] = [
    ["imsmanifest.xml", scormFixtureManifest],
    ["course/learner page.html", "<p>Fictional course file</p>"],
    ["course/example.css", "body { color: blue; }"],
  ],
  options: ZipWriterConstructorOptions = {},
) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
    zip64: false,
    ...options,
  });
  for (const [name, text] of records)
    await writer.add(name, new TextReader(text));
  return Uint8Array.from(await writer.close()).buffer;
}
