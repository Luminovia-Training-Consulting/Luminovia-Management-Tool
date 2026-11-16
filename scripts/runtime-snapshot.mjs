/**
 * Filtert den Quellbaumsnapshot für den isolierten Gesamtprüflauf.
 * Auch verschachtelte Geheimnisse, Laufzeitreste und Symlink-Aliasse werden ausgeschlossen.
 */
import { lstatSync } from "node:fs";
import { isAbsolute, relative } from "node:path";

const generatedDirectories = new Set([
  ".git",
  ".local",
  "node_modules",
  "dist",
  "coverage",
  "test-results",
  "playwright-report",
  "__pycache__",
]);

/** fs.cpSync filter for the disposable QA source snapshot. Credentials and
 * generated state may be nested inside hosting/project folders; a top-level
 * ignore alone does not sanitise the source. Package symlinks are added later
 * by the supervisor, never followed/copied from an arbitrary source path. */
/** Entscheidet pro Pfad, ob er zum QA-Quellbaum gehört; private/generated Zustände und Symlinks werden ausgeschlossen. */
export function runtimeSnapshotSource(source, sourceRoot) {
  const path = relative(sourceRoot, source);
  if (!path) return true;
  const parts = path.split(/[\\/]/);
  if (isAbsolute(path) || parts.includes("..")) return false;
  if (
    parts.some(
      (part) =>
        generatedDirectories.has(part) ||
        (part.startsWith(".env") && part !== ".env.example") ||
        part.endsWith(".tsbuildinfo") ||
        part.endsWith(".pyc"),
    )
  )
    return false;
  if (parts[0] === "supabase" && [".temp", ".branches"].includes(parts[1]))
    return false;
  if (parts[0] === "deploy" && parts[1] === "hostinger") {
    if (
      parts.slice(2).some((part) => part === "private" || part === "site") ||
      parts.at(-1).endsWith(".env")
    )
      return false;
  }
  return !lstatSync(source).isSymbolicLink();
}
