/**
 * Live-tour navigation filtering and best-effort progress storage per actor and browser tab.
 * Stored progress is validated against the public catalog; current capabilities filter stops.
 */
import {type GuideModule, guideModules} from "./catalog";

/** Progress stores only a status and catalog ID; it contains no private record or access grant. */
export type TourState = {
    status: "idle" | "active" | "paused" | "completed";
    step: string;
};
export const initialTour: TourState = {status: "idle", step: "home"};

// These are navigation hints only. Every destination retains its normal server
// permissions and own authoritative mutation confirmation.
export function permittedTourModules(
    roles: readonly string[],
    permissions: readonly string[],
): GuideModule[] {
    const teaching = roles.some((role) =>
        ["owner", "admin", "lecturer", "senior_lecturer"].includes(role),
    );
    return guideModules.filter((module) => {
        // Commercial navigation accepts teaching roles OR the corresponding scoped
        // permission; qualification administration requires BOTH permissions.
        if (module.path === "/contracts")
            return teaching || permissions.includes("contracts.read");
        if (module.path === "/finance")
            return teaching || permissions.includes("finance.manage");
        if (module.path === "/admin/people")
            return (
                permissions.includes("users.manage") &&
                permissions.includes("qualifications.verify")
            );
        return (
            (!module.roles || module.roles.some((role) => roles.includes(role))) &&
            (!module.permission || permissions.includes(module.permission))
        );
    });
}

/** Accept known statuses/catalog IDs from this actor's tab storage, falling back safely on malformed/denied storage. */
export function readTour(actor: string): TourState {
    try {
        const value: unknown = JSON.parse(
            sessionStorage.getItem(`luminovia.tour.v1.${actor}`) ?? "null",
        );
        if (
            value &&
            typeof value === "object" &&
            "status" in value &&
            "step" in value &&
            typeof value.status === "string" &&
            ["idle", "active", "paused", "completed"].includes(value.status) &&
            typeof value.step === "string" &&
            guideModules.some((module) => module.id === value.step)
        )
            return {status: value.status as TourState["status"], step: value.step};
    } catch {
        // Restricted browser storage must not prevent guidance or private routes.
    }
    return initialTour;
}

/** Persist non-sensitive progress best-effort; navigation remains usable when storage is denied. */
export function storeTour(actor: string, state: TourState) {
    try {
        sessionStorage.setItem(`luminovia.tour.v1.${actor}`, JSON.stringify(state));
    } catch {
        // In-memory navigation still works when storage is unavailable.
    }
}