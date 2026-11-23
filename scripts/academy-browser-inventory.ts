/** Build a file-bound browser SBOM from the modules rendered into the Academy. */
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

export const academySbomPath = "api/browser-sbom.cdx.json";
export const academyNoticesPath = "api/dependency-licenses.txt";

type Trace = Record<string, string[]>;
type Chunk = {
  type: string;
  fileName: string;
  modules?: Record<string, { renderedLength: number }>;
};

const readText = (path: string) => readFileSync(path, "utf8");
const sha256 = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

/** Record rendered modules privately. The trace itself never enters the ZIP. */
export function recordAcademyBrowserModules(
  output: Record<string, Chunk>,
  tracePath: string,
) {
  const trace: Trace = {};
  for (const chunk of Object.values(output)) {
    if (chunk.type !== "chunk" || !chunk.modules) continue;
    trace[chunk.fileName] = Object.entries(chunk.modules)
      .filter(
        ([id, module]) =>
          id.includes("/node_modules/") && module.renderedLength > 0,
      )
      .map(([id]) => id);
  }
  writeFileSync(tracePath, JSON.stringify(trace), { mode: 0o600 });
}

/** Resolve package roots relative to the npm tree, including nested installs. */
function packageDirectory(source: string) {
  const parts = source.split("/");
  const first = parts.indexOf("node_modules");
  const last = parts.lastIndexOf("node_modules");
  if (first < 0 || !parts[last + 1]) return null;
  const end = last + (parts[last + 1].startsWith("@") ? 3 : 2);
  const path = parts.slice(first + 1, end);
  if (
    path.some(
      (part) => !/^[a-z0-9@_.-]+$/i.test(part) || part === ".." || part === ".",
    )
  )
    throw new Error("Unsafe Academy dependency path.");
  return path.join("/");
}

const noticesName =
  /^(?:licen[cs]e|copying|notice|copyright)(?:[._-][a-z0-9._-]+)?$|\.license\.txt$/i;

/** Workbox has its own bundler. Read its private maps before removing them. */
function collectWorkbox(dist: string, trace: Trace) {
  const workerAssets = readdirSync(dist).filter((name) =>
    /^(?:sw|workbox-[a-f0-9]{8})\.js$/.test(name),
  );
  if (!workerAssets.some((name) => name.startsWith("workbox-")))
    throw new Error(
      "The browser delivery is missing its generated Workbox runtime.",
    );
  for (const file of workerAssets) {
    const mapPath = join(dist, file + ".map");
    if (!existsSync(mapPath))
      throw new Error("The private Workbox module inventory is missing.");
    const { sources } = JSON.parse(readText(mapPath)) as { sources: string[] };
    trace[file] = sources;
    const path = join(dist, file);
    const source = readText(path).replace(
      /\n\/\/# sourceMappingURL=[^\r\n]+\s*$/,
      "\n",
    );
    writeFileSync(path, source);
    unlinkSync(mapPath);
  }
}

export function writeAcademyBrowserInventory({
  dist,
  tracePath,
  modules,
  packageLock,
  revision,
  edition,
}: {
  dist: string;
  tracePath: string;
  modules: string;
  packageLock: string;
  revision: string;
  edition: "customer-managed" | "customer-self-hosted";
}) {
  const trace = JSON.parse(readText(tracePath)) as Trace;
  const lock = JSON.parse(readText(packageLock)) as {
    packages: Record<
      string,
      { version: string; integrity?: string; license?: string }
    >;
  };
  collectWorkbox(dist, trace);
  const packages = new Map<string, Set<string>>();
  for (const [file, sources] of Object.entries(trace)) {
    for (const source of sources) {
      const packagePath = packageDirectory(source);
      if (!packagePath) continue;
      const files = packages.get(packagePath) ?? new Set<string>();
      files.add(file);
      packages.set(packagePath, files);
    }
  }
  if (!packages.size)
    throw new Error("No rendered browser dependencies were found.");
  const notices = [
    "Academy browser dependency licences",
    `Revision: ${revision}`,
    `Edition: ${edition}`,
  ];
  const components = [...packages]
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([packagePath, files]) => {
      const directory = join(modules, packagePath);
      const metadata = JSON.parse(
        readText(join(directory, "package.json")),
      ) as {
        name: string;
        version: string;
        license?: string;
      };
      const locked = lock.packages["node_modules/" + packagePath];
      const licence = metadata.license ?? locked?.license;
      if (metadata.version !== locked?.version || !licence)
        throw new Error(
          `Unreviewed browser dependency metadata: ${packagePath}`,
        );
      const entries = readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && noticesName.test(entry.name))
        .map(({ name }) => name)
        .sort();
      if (!entries.length) {
        if (
          metadata.name !== "react-remove-scroll-bar" ||
          metadata.version !== "2.3.8" ||
          licence !== "MIT"
        )
          throw new Error(
            `Missing browser dependency licence text: ${packagePath}`,
          );
        // This npm tarball declares MIT but omitted the full text. The
        // publisher's upstream notice is pinned and retained with the build source.
        const upstream =
          "https://github.com/theKashey/react-remove-scroll-bar/blob/7301c160fda44cb8cf2b9fdfde61efad35736196/LICENSE";
        const reviewedNotice = readFileSync(
          new URL(
            "./academy-dependency-notices/react-remove-scroll-bar-2.3.8.txt",
            import.meta.url,
          ),
          "utf8",
        ).trim();
        notices.push(`### ${metadata.name} ${metadata.version} — ${licence} — upstream LICENSE

${upstream}

${reviewedNotice}`);
      }
      for (const file of entries) {
        notices.push(
          `### ${metadata.name} ${metadata.version} — ${licence} — ${file}\n\n${readText(join(directory, file)).trim()}`,
        );
      }
      return {
        type: "library",
        "bom-ref": "npm:" + packagePath,
        name: metadata.name,
        version: metadata.version,
        purl: `pkg:npm/${metadata.name.replace(/^@/, "%40")}@${encodeURIComponent(metadata.version)}`,
        licenses: [{ license: { name: licence } }],
        properties: [...files]
          .sort()
          .map((value) => ({ name: "academy:shipped-in", value })),
      };
    });
  const font = "brand/space-grotesk-latin-wght-normal.woff2";
  const fontNotice = "brand/space-grotesk-OFL.txt";
  notices.push(
    `### Space Grotesk — OFL-1.1 — ${basename(fontNotice)}\n\n${readText(join(dist, fontNotice)).trim()}`,
  );
  components.push({
    type: "file",
    "bom-ref": "asset:space-grotesk",
    name: "Space Grotesk",
    version: sha256(readFileSync(join(dist, font))),
    purl: "",
    licenses: [{ license: { name: "OFL-1.1" } }],
    properties: [{ name: "academy:shipped-in", value: font }],
  });
  const notice = notices.join("\n\n") + "\n";
  const bom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: {
        type: "application",
        name: "Academy browser",
        version: revision,
      },
      properties: [
        { name: "academy:edition", value: edition },
        { name: "academy:dependency-notices-sha256", value: sha256(notice) },
      ],
    },
    components: components.map(({ purl, ...component }) =>
      purl ? { ...component, purl } : component,
    ),
  };
  writeFileSync(
    join(dist, academySbomPath),
    JSON.stringify(bom, null, 2) + "\n",
    { flag: "wx" },
  );
  writeFileSync(join(dist, academyNoticesPath), notice, { flag: "wx" });
}

/** Legacy signed packages may omit the pair. If present, both exact files
 * must describe this revision, edition, and files in the same inventory. */
export function validateAcademyBrowserInventory(
  files: Map<string, Uint8Array>,
  revision: string,
  edition: string,
) {
  const sbom = files.get(academySbomPath);
  const notices = files.get(academyNoticesPath);
  if (!sbom && !notices) return;
  if (!sbom || !notices)
    throw new Error("Incomplete Academy browser dependency inventory.");
  const decode = new TextDecoder("utf-8", { fatal: true });
  const document = JSON.parse(decode.decode(sbom));
  const props = document?.metadata?.properties;
  if (
    document?.bomFormat !== "CycloneDX" ||
    document?.specVersion !== "1.6" ||
    document?.version !== 1 ||
    document?.metadata?.component?.version !== revision ||
    !Array.isArray(props) ||
    props.filter((property) => property?.name === "academy:edition").length !==
      1 ||
    !props.some(
      (property) =>
        property?.name === "academy:edition" && property.value === edition,
    ) ||
    props.filter(
      (property) => property?.name === "academy:dependency-notices-sha256",
    ).length !== 1 ||
    !props.some(
      (property) =>
        property?.name === "academy:dependency-notices-sha256" &&
        property.value === sha256(Buffer.from(notices)),
    ) ||
    !Array.isArray(document?.components) ||
    !document.components.length
  )
    throw new Error(
      "Academy browser dependency inventory differs from the signed delivery.",
    );
  const refs = new Set<string>();
  let hasWorker = false;
  for (const component of document.components) {
    const ref = component?.["bom-ref"];
    const componentFiles = component?.properties;
    if (
      typeof ref !== "string" ||
      !ref ||
      refs.has(ref) ||
      !["file", "library"].includes(component?.type) ||
      typeof component?.name !== "string" ||
      !component.name ||
      typeof component?.version !== "string" ||
      !component.version ||
      !Array.isArray(component?.licenses) ||
      !component.licenses.length ||
      !Array.isArray(componentFiles) ||
      !componentFiles.length ||
      !componentFiles.every(
        (property) =>
          property?.name === "academy:shipped-in" &&
          typeof property.value === "string" &&
          files.has(property.value) &&
          property.value !== academySbomPath &&
          property.value !== academyNoticesPath,
      )
    )
      throw new Error(
        "Academy browser dependency does not resolve to a delivered file.",
      );
    refs.add(ref);
    hasWorker ||= componentFiles.some(({ value }) => /^workbox-/.test(value));
  }
  if (!hasWorker)
    throw new Error(
      "Academy browser inventory omits the delivered worker dependencies.",
    );
}
