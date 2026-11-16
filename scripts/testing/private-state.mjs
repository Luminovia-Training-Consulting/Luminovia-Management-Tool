/**
 * Private JSON-Zustände für lokale Linux-Prüffixtures, insbesondere wiederverwendete MFA-Faktoren.
 * Verzeichnis- und Dateideskriptoren binden Prüfungen an dieselben Objekte; Inhalte und Geheimnisse werden nie protokolliert.
 */
import {
  closeSync,
  constants,
  fstatSync,
  fchmodSync,
  fsyncSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, resolve } from "node:path";

const MAX_STATE_BYTES = 64 * 1024;
const readFlags =
  constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/** Öffnet jeden Elternpfadbestandteil ohne Symlinkfolge und hält das abschließende eigene 0700-Verzeichnis offen. */
function privateParent(file) {
  if (process.platform !== "linux")
    throw new Error("Private fixture state requires the local Linux runtime.");
  const target = resolve(file);
  const parent = dirname(target);
  const flags =
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  let descriptor = openSync("/", flags);
  try {
    for (const part of parent.split("/").filter(Boolean)) {
      const next = openSync(`/proc/self/fd/${descriptor}/${part}`, flags);
      closeSync(descriptor);
      descriptor = next;
    }
    const info = fstatSync(descriptor);
    if (
      !info.isDirectory() ||
      info.uid !== process.getuid() ||
      (info.mode & 0o7777) !== 0o700
    )
      throw new Error(
        "Private fixture parent must be an owned 0700 directory.",
      );
    return {
      descriptor,
      target: `/proc/self/fd/${descriptor}/${basename(target)}`,
    };
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

/** Akzeptiert nur eine eigene einzelne reguläre Datei ohne Gruppen-/Fremdzugriff; der Aufrufer verwendet denselben Deskriptor. */
function privateFile(descriptor) {
  const info = fstatSync(descriptor);
  if (
    !info.isFile() ||
    info.uid !== process.getuid() ||
    info.nlink !== 1 ||
    (info.mode & 0o7077) !== 0
  )
    throw new Error(
      "Private fixture state must be an owned private regular file with one link.",
    );
}

/** Nur eine wirklich fehlende Datei liefert null; unzulässige Pfade, Lesefehler und ungültiges JSON bleiben Fehler. */
export function readPrivateJson(file) {
  const parent = privateParent(file);
  let descriptor;
  try {
    try {
      descriptor = openSync(parent.target, readFlags);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    privateFile(descriptor);
    // Die Größe wird beim Lesen begrenzt: eine nach fstat wachsende Datei darf den Speicherverbrauch nicht umgehen.
    const buffer = Buffer.alloc(MAX_STATE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(
        descriptor,
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (count === 0) break;
      length += count;
    }
    if (length > MAX_STATE_BYTES)
      throw new Error("Private fixture JSON exceeds its bounded size.");
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.subarray(0, length),
        ),
      );
    } catch {
      // Native JSON-Fehler können Teile des geheimen Inhalts enthalten. Die Fehlerart bleibt sichtbar, der Inhalt nicht.
      throw new SyntaxError("Private fixture JSON is malformed.");
    }
  } finally {
    try {
      if (descriptor !== undefined) closeSync(descriptor);
    } finally {
      closeSync(parent.descriptor);
    }
  }
}

/** Schreibt begrenztes JSON exklusiv in eine eigene 0600-Temporärdatei und ersetzt das Ziel atomar ohne Symlinkfolge. */
export function writePrivateJson(file, value) {
  const json = JSON.stringify(value);
  if (json === undefined)
    throw new TypeError("Private fixture state must be JSON serializable.");
  const bytes = Buffer.from(json, "utf8");
  if (bytes.length > MAX_STATE_BYTES)
    throw new Error("Private fixture JSON exceeds its bounded size.");
  const parent = privateParent(file);
  const temporary = `${parent.target}.${randomUUID()}.tmp`;
  let descriptor;
  let temporaryOwned = false;
  try {
    // Eine vorhandene Zieldatei wird am geöffneten Objekt geprüft, nicht über exists/lstat vor einem folgenden Dateischreiben.
    // rename ersetzt nur den Verzeichniseintrag und folgt auch einer später eingetauschten Zielsymlink niemals.
    let current;
    try {
      current = openSync(parent.target, readFlags);
      privateFile(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    } finally {
      if (current !== undefined) closeSync(current);
    }
    descriptor = openSync(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    temporaryOwned = true;
    privateFile(descriptor);
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, parent.target);
    temporaryOwned = false;
    fsyncSync(parent.descriptor);
  } finally {
    try {
      if (descriptor !== undefined) closeSync(descriptor);
    } finally {
      try {
        if (temporaryOwned) unlinkSync(temporary);
      } finally {
        closeSync(parent.descriptor);
      }
    }
  }
}
