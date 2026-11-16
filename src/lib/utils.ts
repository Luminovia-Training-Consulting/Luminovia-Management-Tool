/**
 * Gemeinsame Klassenkomposition für React-Komponenten. clsx löst bedingte Klassen auf, tailwind-merge bereinigt anschließend widersprüchliche Tailwind-Klassen.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
/** Kombiniert bedingte Klassennamen und löst anschließend widersprüchliche Tailwind-Utilities auf. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
