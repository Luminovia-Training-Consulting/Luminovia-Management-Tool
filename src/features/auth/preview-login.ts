/** Only the owned loopback GitHub preview recognises its fictional shorthand. */
export function previewLoginEmail(
    value: string,
    origin: string,
    backend: string | undefined,
) {
    try {
        const site = new URL(origin);
        const api = new URL(backend ?? "");
        if (
            value === "admin" &&
            site.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(site.hostname) &&
            site.port === "5373" &&
            api.origin === "http://127.0.0.1:56321"
        )
            return "local-preview-admin@example.invalid";
    } catch {
        /* A missing or invalid backend never enables the local alias. */
    }
    return value;
}