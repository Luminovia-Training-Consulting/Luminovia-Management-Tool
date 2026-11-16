/** The preview changes only local service identity and loopback ports. */
export function githubPreviewConfig(source, project) {
  if (!/^luminovia-portal-github-[a-f0-9]{12}$/.test(project))
    throw new Error("Invalid owned GitHub preview project.");
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
        if (port[1] === "inspector_port") return `${port[1]} = 56383`;
        if (value < 54300 || value > 54399)
          throw new Error(
            "Unknown local port layout; preview source needs review.",
          );
        return `${port[1]} = ${value + 2000}`;
      }
      if (section === "auth" && /^site_url\s*=/.test(line)) {
        const value = /"([^"]+)"/.exec(line)?.[1];
        if (value !== "http://127.0.0.1:5173")
          throw new Error(
            "Unexpected Auth origin; preview source needs review.",
          );
        siteCount++;
        return 'site_url = "http://127.0.0.1:5373"';
      }
      if (section === "auth" && /^additional_redirect_urls\s*=/.test(line))
        return 'additional_redirect_urls = ["http://127.0.0.1:5373/auth/callback", "http://localhost:5373/auth/callback"]';
      return line;
    })
    .join("\n");
  if (projectCount !== 1 || siteCount !== 1)
    throw new Error("Missing unique local project/Auth origin.");
  return config;
}
