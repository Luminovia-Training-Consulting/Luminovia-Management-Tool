/**
 * Builds the bounded configuration overlay for the separate GitHub preview.
 * Project identity and loopback ports stay separate; nested QA/preview overlays are rejected.
 */

/** The preview changes only local service identity and loopback ports. */
/** Builds only the known loopback/project overlay and rejects incompatible or already overlaid source. */
export function githubPreviewConfig(source, project) {
    if (!/^luminovia-portal-github-[a-f0-9]{12}$/.test(project))
        throw new Error("Invalid owned GitHub preview project.");
    // Keep the persistent preview outside the canonical (54xxx), PR (57xxx),
    // and older managed preview (61xxx) stacks. The previous 56xxx overlay
    // overlapped live PR previews and made first startup fail with EADDRINUSE.
    return previewConfig(source, project, 10000, 5373);
}

/** PR packages have their own volumes AND ports, separate from normal
 * development, full tests and the persistent latest-main GitHub preview. */
export function prPreviewConfig(source, project) {
    if (!/^luminovia-portal-pr-[1-9][0-9]*-[a-f0-9]{12}$/.test(project))
        throw new Error("Invalid owned PR preview project.");
    return previewConfig(source, project, 3000, 5473);
}

function previewConfig(source, project, offset, sitePort) {
    let section = "";
    let projectCount = 0;
    let siteCount = 0;
    const config = source
        .split("\n")
        .map((line) => {
            const heading = /^\[([^\]]+)\]/.exec(line);
            if (heading) section = heading[1];
            if (/^project_id\s*=/.test(line)) {
                projectCount++;
                return `project_id = "${project}"`;
            }
            const port =
                /^(port|shadow_port|inspector_port)\s*=\s*(\d+)\s*(?:#.*)?$/.exec(line);
            if (port) {
                const value = Number(port[2]);
                if (port[1] === "inspector_port")
                    return `${port[1]} = ${54383 + offset}`;
                if (value < 54300 || value > 54399)
                    throw new Error(
                        "Unknown local port layout; preview source needs review.",
                    );
                return `${port[1]} = ${value + offset}`;
            }
            if (section === "auth" && /^site_url\s*=/.test(line)) {
                const value = /"([^"]+)"/.exec(line)?.[1];
                if (value !== "http://127.0.0.1:5173")
                    throw new Error(
                        "Unexpected Auth origin; preview source needs review.",
                    );
                siteCount++;
                return `site_url = "http://127.0.0.1:${sitePort}"`;
            }
            if (section === "auth" && /^additional_redirect_urls\s*=/.test(line))
                return `additional_redirect_urls = ["http://127.0.0.1:${sitePort}/auth/callback", "http://localhost:${sitePort}/auth/callback"]`;
            return line;
        })
        .join("\n");
    if (projectCount !== 1 || siteCount !== 1)
        throw new Error("Missing unique local project/Auth origin.");
    return config;
}