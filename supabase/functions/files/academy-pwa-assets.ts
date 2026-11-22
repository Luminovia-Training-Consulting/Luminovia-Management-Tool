const assets = {
    icon_192: {sizes: "192x192"},
    icon_512: {sizes: "512x512"},
    maskable_512: {sizes: "512x512", purpose: "maskable"},
} as const;

type Variant = keyof typeof assets;
type ManifestBrand = {version: number; name: string; short_name: string; theme_color: string};
type AssetReads = {
    manifest: () => Promise<unknown>;
    image: (variant: Variant, version: number | null) => Promise<unknown>;
};

const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
};

function hasManifest(value: unknown): value is ManifestBrand {
    if (!value || typeof value !== "object") return false;
    const brand = value as Record<string, unknown>;
    return typeof brand.version === "number" && Number.isInteger(brand.version)
        && brand.version > 0 && brand.version <= 2_147_483_647
        && typeof brand.name === "string" && brand.name.length > 0 && brand.name.length <= 144
        && typeof brand.short_name === "string" && brand.short_name.length > 0 && brand.short_name.length <= 40
        && typeof brand.theme_color === "string" && /^#[a-f0-9]{6}$/.test(brand.theme_color);
}

/** Published, installation-local public assets. The signed files are served by the ingress on fallback. */
export async function serveAcademyPwaAsset(
    method: string, params: URLSearchParams, reads: AssetReads,
): Promise<Response | undefined> {
    const mode = params.get("mode");
    if (!((method === "GET" || method === "HEAD")
        && (mode === "academy-pwa-manifest" || mode === "academy-pwa-image"))) return;
    const missing = () => new Response(null, {status: 404, headers});
    const ok = (type: string, body: BodyInit) => new Response(method === "HEAD" ? null : body, {
        headers: {...headers, "Content-Type": type},
    });
    try {
        if (mode === "academy-pwa-manifest") {
            if (params.size !== 1) return missing();
            const brand = await reads.manifest();
            if (!hasManifest(brand)) return missing();
            return ok("application/manifest+json; charset=utf-8", JSON.stringify({
                id: "/", start_url: "/", scope: "/", display: "standalone",
                name: brand.name, short_name: brand.short_name, description: brand.name,
                theme_color: brand.theme_color, background_color: "#f8f5ee",
                icons: Object.entries(assets).map(([variant, options]) => ({
                    ...options, type: "image/png",
                    src: `/backend/functions/v1/files?mode=academy-pwa-image&variant=${variant}&version=${brand.version}`,
                })),
            }));
        }
        const variant = params.get("variant");
        const revision = params.get("version");
        if (params.size !== (revision === null ? 2 : 3) || !variant || !Object.hasOwn(assets, variant)) return missing();
        if (revision !== null && (!/^[1-9]\d{0,9}$/.test(revision) || Number(revision) > 2_147_483_647)) return missing();
        const payload = await reads.image(variant as Variant, revision === null ? null : Number(revision));
        if (typeof payload !== "string" || payload.length < 76 || payload.length > 1_333_336) return missing();
        return ok("image/png", Uint8Array.from(atob(payload), (byte) => byte.charCodeAt(0)));
    } catch {
        return new Response(null, {status: 503, headers});
    }
}
