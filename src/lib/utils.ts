/**
 * Shared React class composition: clsx resolves conditional classes, then tailwind-merge removes
 * conflicting Tailwind utilities.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
/** Combine conditional classes and resolve conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
