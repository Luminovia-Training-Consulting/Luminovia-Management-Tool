/** Real Chromium verifies the distinct-origin launch, adapter and bookmark resume. */
import assert from "node:assert/strict";
import console from "node:console";
import { setTimeout } from "node:timers";
import { createServer } from "node:http";
import { once } from "node:events";
import { chromium } from "playwright";
import { createScormHost } from "./host.mjs";

const portal = createServer();
portal.listen(0, "127.0.0.1");
await once(portal, "listening");
const portalOrigin = "http://127.0.0.1:" + portal.address().port;
const allocation = createServer();
allocation.listen(0, "127.0.0.1");
await once(allocation, "listening");
const port = allocation.address().port;
await new Promise((resolve) => allocation.close(resolve));
const runnerHost = "127.0.0.1:" + port;
const runnerOrigin = "http://" + runnerHost;
const runtime = createScormHost({
  portalOrigin,
  domain: "",
  localHost: runnerHost,
});
const launch = "01816516-4365-44e9-a29a-eea36c41b731";
runtime.listen(port, "127.0.0.1");
await once(runtime, "listening");
const sci = `
  const api = window.parent.API;
  api.LMSGetValue("cmi.core.lesson_location");
  if (api.LMSGetLastError() === "301" && api.LMSInitialize("") !== "true")
    throw Error("Missing SCORM API");
  document.querySelector("output").textContent = window.parent.API.LMSGetValue("cmi.core.lesson_location") || "Initial lesson";
  document.querySelector("button").onclick = () => {
    if (window.parent.API.LMSSetValue("cmi.core.lesson_location", "Page 2") !== "true") throw Error("Set bookmark");
    window.parent.API.LMSSetValue("cmi.core.lesson_status", "completed");
    window.parent.API.LMSSetValue("cmi.core.exit", "suspend");
    if (window.parent.API.LMSFinish("") !== "true") throw Error("Finish lesson");
  };
`;
let committed;
let receiveCommit;
const saved = new Promise((resolve) => {
  receiveCommit = resolve;
});
portal.on("request", (_request, response) => {
  const script = `
    window.addEventListener("message", (event) => {
      const runner = document.querySelector("iframe");
      if (event.origin !== ${JSON.stringify(runnerOrigin)} || event.source !== runner.contentWindow || event.data?.launch !== ${JSON.stringify(launch)}) return;
      if (event.data.type === "scorm:ready") {
        const encode = (value) => new TextEncoder().encode(value);
        runner.contentWindow.postMessage({
          type: "scorm:launch", launch: ${JSON.stringify(launch)}, title: "Fictional active lesson", path: "course/lesson.html",
          files: [
            ["course/lesson.html", encode('<!doctype html><html><head><link rel="stylesheet" href="lesson.css"></head><body><output></output><a href="pages/notes.html#remark">Notes</a><button type="button">Complete lesson</button><script src="lesson.js"><' + '/script></body></html>')],
            ["course/pages/notes.html", encode('<!doctype html><html><body><h2 id="remark">Reviewed notes</h2><a href="../lesson.html">Return to lesson</a><a href="https://example.invalid/">Remote link</a></body></html>')],
            ["course/lesson.js", encode(${JSON.stringify(sci)})],
            ["course/lesson.css", encode("output{color:rgb(0, 80, 0)}")],
          ],
          cmi: ${JSON.stringify(committed ?? {})},
          adapter: { studentId: "pseudonym", studentName: "Learner", totalTime: "0000:00:00.00", launchData: "", masteryScore: null },
        }, ${JSON.stringify(runnerOrigin)});
      }
      if (event.data.type === "scorm:commit") window.recordScormCommit(event.data.cmi);
    });
  `;
  response.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
  response.end(
    '<!doctype html><html lang="en"><title>Course launcher test</title><script>' +
      script +
      '</script><iframe title="SCORM launcher" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" src="' +
      runnerOrigin +
      "/launch#" +
      launch +
      '"></iframe></html>',
  );
});
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.exposeFunction("recordScormCommit", (data) => {
    committed = data;
    receiveCommit(data);
  });
  await page.goto(portalOrigin);
  const runner = page.frameLocator("iframe");
  const lesson = runner.frameLocator("iframe");
  const output = lesson.locator("output");
  await output.getByText("Initial lesson", { exact: true }).waitFor();
  assert.equal(
    await output.evaluate(
      (element) =>
        element.ownerDocument.defaultView.getComputedStyle(element).color,
    ),
    "rgb(0, 80, 0)",
  );
  await lesson.getByRole("link", { name: "Notes" }).press("Enter");
  await lesson.getByRole("heading", { name: "Reviewed notes" }).waitFor();
  assert.equal(
    await lesson
      .locator("h2")
      .evaluate((element) => element.ownerDocument.location.hash),
    "#remark",
  );
  assert.equal(
    await lesson.getByRole("link", { name: "Remote link" }).count(),
    0,
  );
  await lesson.getByRole("link", { name: "Return to lesson" }).click();
  await output.getByText("Initial lesson", { exact: true }).waitFor();
  await lesson.getByRole("button", { name: "Complete lesson" }).click();
  await Promise.race([
    saved,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("SCORM commit not delivered")),
        5000,
      ).unref(),
    ),
  ]);
  assert.equal(committed["cmi.core.lesson_status"], "completed");
  assert.equal(committed["cmi.core.exit"], "suspend");
  assert.equal(committed["cmi.core.lesson_location"], "Page 2");
  await page.reload();
  await output.getByText("Page 2", { exact: true }).waitFor();
  console.log(
    "PASS isolated Chromium SCORM scripts, local navigation, commit and bookmark resume.",
  );
} finally {
  await browser.close();
  runtime.close();
  portal.close();
}
