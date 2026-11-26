/* global window, document, location, navigator */
/** Run exact reviewed SCORM files on the dedicated, cookie-free launch origin. */
import { createScormApi } from "./api.mjs";

const portalOrigin = document.querySelector(
  'meta[name="portal-origin"]',
)?.content;
const contentPolicy = document.querySelector(
  'meta[name="content-policy"]',
)?.content;
const launch = location.hash.slice(1);
const root = window.parent;

if (
  portalOrigin &&
  contentPolicy &&
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
    void openLesson(payload, send).catch(() => send("scorm:error"));
  };
  window.addEventListener("message", activate);
  send("scorm:ready");
}

const mime = new Map([
  ["html", "text/html;charset=utf-8"],
  ["htm", "text/html;charset=utf-8"],
  ["js", "text/javascript"],
  ["mjs", "text/javascript"],
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
  ["vtt", "text/vtt"],
]);

function assetFor(files, address) {
  try {
    const parts = address.split("/").map(decodeURIComponent);
    if (
      parts.some(
        (segment) =>
          !segment ||
          segment === "." ||
          segment === ".." ||
          /[/\\]/.test(segment),
      )
    )
      return null;
    const path = parts.join("/");
    const bytes = files.get(path);
    const type = mime.get(path.split(".").pop().toLowerCase());
    return bytes && type ? { bytes, type, policy: contentPolicy } : null;
  } catch {
    return null;
  }
}

async function openLesson(payload, send) {
  const files = new Map(payload.files);
  if (
    !files.has(payload.path) ||
    files.size > 512 ||
    !/\.html?$/i.test(payload.path)
  )
    throw new Error("Missing reviewed launch file");
  const service = navigator.serviceWorker;
  const registration = await service.register("/virtual-files.js", {
    scope: "/",
  });

  const dispose = () => {
    service.removeEventListener("message", onFile);
    void registration.unregister();
  };
  const onFile = (event) => {
    if (event.source !== service.controller || event.ports.length !== 1) return;
    const port = event.ports[0];
    port.postMessage(assetFor(files, event.data.path));
    port.close();
  };
  service.addEventListener("message", onFile);
  try {
    await waitForWorkerControl(service);
  } catch (error) {
    dispose();
    throw error;
  }

  window.API = createScormApi(payload.cmi, {
    ...payload.adapter,
    commit: (cmi) => send("scorm:commit", { cmi }),
  });
  const frame = document.createElement("iframe");
  frame.title = payload.title;
  frame.referrerPolicy = "no-referrer";
  frame.src =
    "/scorm/session/" +
    payload.path.split("/").map(encodeURIComponent).join("/");
  document.body.replaceChildren(frame);
  window.addEventListener("pagehide", dispose, { once: true });
}

function waitForWorkerControl(service) {
  if (service.controller) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      service.removeEventListener("controllerchange", ready);
      reject(new Error("SCORM asset worker did not become ready"));
    }, 5000);
    function ready() {
      clearTimeout(timeout);
      resolve();
    }
    service.addEventListener("controllerchange", ready, { once: true });
  });
}
