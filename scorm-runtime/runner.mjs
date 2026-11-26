/* global window, document, location, DOMParser, TextDecoder, URL, Blob */
/** Origin-isolated launcher. Only this origin sees the SCO DOM and runs package scripts. */
import { createScormApi } from "./api.mjs";

const portalOrigin = document.querySelector(
  'meta[name="portal-origin"]',
)?.content;
const launch = location.hash.slice(1);
const root = window.parent;
if (
  portalOrigin &&
  root !== window &&
  portalOrigin !== location.origin &&
  /^[a-f0-9-]{36}$/.test(launch)
) {
  const send = (type, payload = {}) =>
    root.postMessage({ type, launch, ...payload }, portalOrigin);
  const activate = (event) => {
    const payload = event.data;
    if (
      event.origin !== portalOrigin ||
      event.source !== root ||
      payload?.launch !== launch
    )
      return;
    if (payload.type === "scorm:hello") {
      send("scorm:ready");
      return;
    }
    if (payload.type !== "scorm:launch") return;
    window.removeEventListener("message", activate);
    try {
      openLesson(payload, send);
    } catch {
      send("scorm:error");
    }
  };
  window.addEventListener("message", activate);
  send("scorm:ready");
}

function openLesson(payload, send) {
  const files = new Map(payload.files);
  if (!files.has(payload.path) || files.size > 512)
    throw new Error("Missing launch file");
  const shell = new DOMParser().parseFromString(
    "<!doctype html><html></html>",
    "text/html",
  );
  // Parse archived markup in an inert template. The approved resource mapping
  // replaces URL attributes before a dedicated-origin browser loads the frame.
  const template = shell.createElement("template");
  const text = new TextDecoder("utf-8", { fatal: true });
  template.innerHTML = text.decode(files.get(payload.path));
  if (
    template.content.querySelector(
      "frame,frameset,iframe,object,embed,base,form",
    )
  ) {
    throw new Error("Unsupported SCORM launch layout");
  }
  const assetUrls = new Map();
  const mime = new Map([
    ["js", "text/javascript"],
    ["css", "text/css"],
    ["png", "image/png"],
    ["gif", "image/gif"],
    ["jpg", "image/jpeg"],
    ["jpeg", "image/jpeg"],
    ["webp", "image/webp"],
    ["mp3", "audio/mpeg"],
    ["mp4", "video/mp4"],
    ["ogg", "audio/ogg"],
    ["wav", "audio/wav"],
    ["woff", "font/woff"],
    ["woff2", "font/woff2"],
  ]);
  const identify = (value, relativeTo) => {
    if (!value || value.startsWith("//") || /[\\:]/.test(value)) return null;
    const source =
      "https://assets.invalid/" +
      relativeTo.split("/").map(encodeURIComponent).join("/");
    const url = new URL(value, source);
    const path = url.pathname
      .split("/")
      .slice(1)
      .map(decodeURIComponent)
      .join("/");
    if (url.origin !== "https://assets.invalid" || !files.has(path))
      return null;
    return path;
  };
  const urlFor = (value, relativeTo = payload.path, expectedMime = "") => {
    const path = identify(value, relativeTo);
    if (!path) return null;
    const extension = path.split(".").pop()?.toLowerCase();
    const mediaType = mime.get(extension);
    if (!mediaType || (expectedMime && !mediaType.startsWith(expectedMime)))
      return null;
    const existing = assetUrls.get(path);
    if (existing) return existing;
    let bytes = files.get(path);
    if (extension === "css") {
      const css = text.decode(bytes);
      if (/@import\b/i.test(css))
        throw new Error("Nested SCORM style sheets are unsupported");
      bytes = css.replace(
        /url\(\s*(["']?)([^\r\n"'()]+)\1\s*\)/gi,
        (_, quote, url) => {
          const type = mime.get(
            identify(url.trim(), path)?.split(".").pop()?.toLowerCase(),
          );
          const mapped =
            type && type !== "text/css" && type !== "text/javascript"
              ? urlFor(url.trim(), path)
              : null;
          return mapped ? `url("${mapped}")` : 'url("about:blank")';
        },
      );
    }
    const address = URL.createObjectURL(new Blob([bytes], { type: mediaType }));
    assetUrls.set(path, address);
    return address;
  };

  for (const element of template.content.querySelectorAll("*")) {
    if (element.localName === "meta") {
      element.remove();
      continue;
    }
    if (element.namespaceURI !== "http://www.w3.org/1999/xhtml") {
      element.remove();
      continue;
    }
    for (const attribute of [...element.attributes]) {
      if (
        /^(action|srcset|target|ping|formaction|srcdoc|background|manifest|data|xlink:href|attributionsrc)$/i.test(
          attribute.name,
        )
      ) {
        element.removeAttribute(attribute.name);
      }
    }
    for (const attribute of ["href", "src", "poster"]) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      if (
        attribute === "href" &&
        element.localName === "a" &&
        value.startsWith("#")
      )
        continue;
      const expected =
        element.localName === "script" && attribute === "src"
          ? "text/javascript"
          : element.localName === "link" &&
              attribute === "href" &&
              element.getAttribute("rel")?.toLowerCase() === "stylesheet"
            ? "text/css"
            : ["img", "video", "source", "audio", "track"].includes(
                  element.localName,
                )
              ? ""
              : null;
      const mapped =
        expected === null ? null : urlFor(value, payload.path, expected);
      if (mapped) element.setAttribute(attribute, mapped);
      else if (element.localName === "script" || element.localName === "link")
        throw new Error("Unsupported linked resource");
      else element.removeAttribute(attribute);
    }
  }

  window.API = createScormApi(payload.cmi, {
    ...payload.adapter,
    commit: (cmi) => send("scorm:commit", { cmi }),
  });
  const iframe = document.createElement("iframe");
  iframe.title = payload.title;
  iframe.referrerPolicy = "no-referrer";
  const launchMarkup =
    "<!doctype html><html><head><meta charset=utf-8></head><body>" +
    template.innerHTML +
    "</body></html>";
  const contentUrl = URL.createObjectURL(
    new Blob([launchMarkup], { type: "text/html;charset=utf-8" }),
  );
  iframe.src = contentUrl;
  document.body.replaceChildren(iframe);
  window.addEventListener(
    "pagehide",
    () => {
      URL.revokeObjectURL(contentUrl);
      for (const url of assetUrls.values()) URL.revokeObjectURL(url);
    },
    { once: true },
  );
}
