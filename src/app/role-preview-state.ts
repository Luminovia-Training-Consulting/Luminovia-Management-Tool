import { useState } from "react";
import { installationBrand } from "../lib/installation-brand";

const staffViews = ["company", "participant"] as const;
const allViews = ["management", "lecturer", ...staffViews] as const;
export type PreviewRole = (typeof allViews)[number];

export function availableRolePreviews(
  authority: "administrator" | "management" | null,
): readonly PreviewRole[] {
  if (authority === "administrator") return allViews;
  if (authority === "management") return staffViews;
  return [];
}

function preferenceKey(actor: string) {
  return `portal.role-preview.hidden.${installationBrand.installationId}.${actor}`;
}

function readHidden(actor: string): readonly PreviewRole[] {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(preferenceKey(actor)) ?? "null",
    );
    return Array.isArray(saved)
      ? allViews.filter((role) => saved.includes(role))
      : [];
  } catch {
    return [];
  }
}

/** A visual preference is actor-bound and may only narrow views the server role already allows. */
export function useRolePreview(actor: string, allowed: readonly PreviewRole[]) {
  const [selection, setSelection] = useState<{
    actor: string;
    role: PreviewRole;
  } | null>(null);
  const [preferences, setPreferences] = useState(() => ({
    actor,
    hidden: readHidden(actor),
  }));
  const hidden =
    preferences.actor === actor ? preferences.hidden : readHidden(actor);
  const visible = allowed.filter((role) => !hidden.includes(role));
  const requested = selection?.actor === actor ? selection.role : null;
  return {
    allowed,
    visible,
    requested,
    current: requested && visible.includes(requested) ? requested : null,
    select(value: string) {
      if (value === "live") setSelection(null);
      else {
        const role = visible.find((candidate) => candidate === value);
        if (role) setSelection({ actor, role });
      }
    },
    setVisible(role: PreviewRole, show: boolean) {
      if (!allowed.includes(role)) return;
      const next = show
        ? hidden.filter((candidate) => candidate !== role)
        : [...hidden, role];
      setPreferences({ actor, hidden: next });
      try {
        localStorage.setItem(preferenceKey(actor), JSON.stringify(next));
      } catch {
        // The preference remains usable for the current render session.
      }
    },
  };
}

export type RolePreviewState = ReturnType<typeof useRolePreview>;
