/** Control an H5P session on the isolated content origin. No portal credentials cross this boundary. */
import {
  checkedManifest,
  mediaType,
  sanitizePackageContent,
} from "./content-policy.mjs";

const node = document.getElementById("activity");
const session = new URL(location.href).searchParams.get("session");
const validSession = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const virtual = new Map();
const encode = new TextEncoder();
const fileLimit = 25 * 1024 * 1024;
const itemLimit = 256;
const decoder = new TextDecoder("utf-8", { fatal: true });
const status = (text) => {
  node.textContent = text;
};

async function loadConfig() {
  const request = (path) =>
    fetch(path, { credentials: "omit", cache: "no-store" }).then(
      async (response) => {
        if (!response.ok)
          throw new Error("H5P runtime configuration is unavailable");
        return response.json();
      },
    );
  const [configuration, libraries] = await Promise.all([
    request("configuration.json"),
    request("catalogue.json"),
  ]);
  return {
    portalOrigin: configuration.portalOrigin,
    catalogue: new Set(libraries.installed),
    playable: new Set(libraries.playable),
  };
}

function report(statement, post, singleQuestion) {
  const verb = statement?.verb?.id;
  if (
    typeof verb !== "string" ||
    !/^http:\/\/adlnet.gov\/expapi\/verbs\/(answered|completed|passed|failed)$/.test(
      verb,
    )
  )
    return;
  const onlyLocalInteraction = verb.endsWith("/answered") && !singleQuestion;
  const result = onlyLocalInteraction ? null : statement.result;
  const scaled = result?.score?.scaled;
  post({
    type: "h5p-progress",
    verb: verb.split("/").at(-1),
    completed: result?.completion === true || verb.endsWith("/completed"),
    score:
      typeof scaled === "number" &&
      Number.isFinite(scaled) &&
      scaled >= 0 &&
      scaled <= 1
        ? scaled
        : null,
  });
}

async function activeWorker() {
  await navigator.serviceWorker.register("virtual-files.js", {
    scope: "/h5p/",
  });
  await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Virtual content files are unavailable")),
      10_000,
    );
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function construct(input, { catalogue, playable }, post) {
  const { files } = input;
  if (!Array.isArray(files) || files.length > itemLimit)
    throw new Error("Invalid H5P asset list");
  const total = files.reduce(
    (amount, item) => amount + (item?.bytes?.byteLength ?? Infinity),
    0,
  );
  if (total > fileLimit)
    throw new Error("H5P content exceeds the playback limit");
  const directory = `/h5p/session/${session}`;
  const addJson = (path, value) =>
    virtual.set(directory + "/" + path, {
      bytes: encode.encode(JSON.stringify(value)),
      type: "application/json",
    });
  let singleQuestion = false;
  for (const file of files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      !(file.bytes instanceof ArrayBuffer) ||
      !file.bytes.byteLength
    )
      throw new Error("Invalid H5P asset");
    const key = directory + "/" + file.path;
    if (virtual.has(key)) throw new Error("Duplicate H5P asset");
    if (file.path === "h5p.json") {
      const manifest = checkedManifest(
        JSON.parse(decoder.decode(file.bytes)),
        catalogue,
        playable,
      );
      document.documentElement.lang = /^[a-z]{2}$/.test(manifest.language)
        ? manifest.language
        : "en";
      document.title = manifest.title;
      singleQuestion =
        manifest.mainLibrary === "H5P.MultiChoice" ||
        manifest.mainLibrary === "H5P.TrueFalse";
      addJson(file.path, manifest);
    } else if (file.path === "content/content.json") {
      const data = JSON.parse(decoder.decode(file.bytes));
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new Error("Invalid H5P content JSON");
      addJson(file.path, sanitizePackageContent(data, catalogue));
    } else {
      const type = mediaType(file.path);
      if (!type) throw new Error("Unsupported H5P media");
      virtual.set(key, { bytes: file.bytes, type });
    }
  }
  if (
    !virtual.has(directory + "/h5p.json") ||
    !virtual.has(directory + "/content/content.json")
  )
    throw new Error("H5P package content is missing");
  status("");
  await new window.H5PStandalone.H5P(node, {
    h5pJsonPath: directory,
    librariesPath: "/h5p/libraries",
    frameJs: "/h5p/player/frame.bundle.js",
    frameCss: "/h5p/player/styles/h5p.css",
    frame: true,
    copyright: true,
    fullScreen: false,
    assetsRequestFetchOptions: { credentials: "omit", cache: "no-store" },
  });
  const frame = node.querySelector("iframe");
  const bind = () => {
    const dispatcher =
      frame?.contentWindow?.H5P?.externalDispatcher ??
      window.H5P?.externalDispatcher;
    if (dispatcher)
      dispatcher.on("xAPI", (event) =>
        report(event?.data?.statement, post, singleQuestion),
      );
  };
  bind();
  frame?.addEventListener("load", bind, { once: true });
  post({ type: "h5p-started" });
}

async function launch() {
  if (!validSession.test(session ?? "") || self === parent || !isSecureContext)
    throw new Error("An isolated HTTPS frame is required");
  const configuration = await loadConfig();
  const { portalOrigin } = configuration;
  const post = (payload) =>
    parent.postMessage({ ...payload, session }, portalOrigin);
  navigator.serviceWorker.addEventListener(
    "message",
    ({ source, data, ports }) => {
      if (
        source !== navigator.serviceWorker.controller ||
        typeof data?.path !== "string" ||
        !ports[0]
      )
        return;
      let key;
      try {
        key = decodeURIComponent(data.path);
      } catch {
        ports[0].postMessage(null);
        return;
      }
      ports[0].postMessage(virtual.get(key) ?? null);
    },
  );
  await activeWorker();
  let used = false;
  addEventListener("message", async ({ origin, source, data }) => {
    if (
      origin !== portalOrigin ||
      source !== parent ||
      data?.type !== "h5p-open" ||
      data?.session !== session ||
      used
    )
      return;
    used = true;
    try {
      await construct(data, configuration, post);
    } catch {
      virtual.clear();
      status("H5P content unavailable");
      post({ type: "h5p-error" });
    }
  });
  addEventListener("pagehide", () => virtual.clear(), { once: true });
  post({ type: "h5p-ready" });
}

void launch().catch(() => status("H5P player unavailable"));
