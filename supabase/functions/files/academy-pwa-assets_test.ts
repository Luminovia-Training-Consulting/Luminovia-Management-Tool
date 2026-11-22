import { serveAcademyPwaAsset } from "./academy-pwa-assets.ts";

const assert = (condition: unknown) => {
    if (!condition) throw new Error("Assertion failed");
};

Deno.test("academy PWA manifest keeps the installed identity and binds all icons to one current revision", async () => {
    const calls: [string, number | null][] = [];
    const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR2sAAAAASUVORK5CYII=";
    const reads = {
        manifest: () => Promise.resolve({name: "Practice", short_name: "Practice", theme_color: "#123456", version: 12}),
        image: (variant: string, version: number | null) => {
            calls.push([variant, version]);
            return Promise.resolve(version === 12 || version === null ? image : null);
        },
    };
    const serve = (query: string, verb = "GET") => serveAcademyPwaAsset(verb, new URLSearchParams(query), reads);
    const manifestResponse = await serve("mode=academy-pwa-manifest");
    assert(manifestResponse?.status === 200);
    assert(manifestResponse?.headers.get("cache-control") === "no-store");
    const manifest = await manifestResponse!.json();
    assert(manifest.id === "/" && manifest.start_url === "/" && manifest.scope === "/");
    assert(manifest.icons.length === 3 && manifest.icons[2].purpose === "maskable");
    for (const entry of manifest.icons) {
        const source = new URL(entry.src, "https://academy.example.invalid");
        assert(source.origin === "https://academy.example.invalid" && source.searchParams.get("version") === "12");
        assert((await serve(source.search))?.headers.get("content-type") === "image/png");
    }
    assert(calls.length === 3 && calls.every((entry) => entry[1] === 12));
    assert((await serve("mode=academy-pwa-image&variant=icon_512&version=11"))?.status === 404);
    assert((await serve("mode=academy-pwa-image&variant=icon_512", "HEAD"))?.body === null);
    assert(calls.at(-1)?.[1] === null);
});

Deno.test("unknown or duplicated PWA selectors never read branding or unrelated assets", async () => {
    let calls = 0;
    const read = () => { calls++; return Promise.resolve(null); };
    const serve = (query: string, method = "GET") => serveAcademyPwaAsset(method, new URLSearchParams(query), {manifest: read, image: read});
    for (const query of [
        "mode=academy-pwa-manifest&mode=academy-pwa-manifest",
        "mode=academy-pwa-image&variant=icon_512&version=05",
        "mode=academy-pwa-image&variant=__proto__",
        "mode=academy-pwa-image&variant=icon_512&version=2147483648",
    ]) assert((await serve(query))?.status === 404);
    assert(await serve("mode=academy-pwa-manifest", "POST") === undefined);
    assert(await serve("mode=academy-pwa-icon", "GET") === undefined);
    assert(calls === 0);
    assert((await serve("mode=academy-pwa-manifest"))?.status === 404);
    assert(calls === 1);
});
