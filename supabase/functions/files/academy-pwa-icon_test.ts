import { assertEquals } from "jsr:@std/assert@1.0.15";
import { deflateSync } from "node:zlib";
import { Buffer } from "node:buffer";
import { crc32 } from "./avatar.ts";
import { uploadAcademyPwaIcon } from "./academy-pwa-icon.ts";

function chunk(type: string, content: Uint8Array) {
  const body = Buffer.concat([Buffer.from(type), content]);
  const result = Buffer.alloc(content.length + 12);
  result.writeUInt32BE(content.length);
  result.set(body, 4);
  result.writeUInt32BE(crc32(body), content.length + 8);
  return result;
}
function png(edge: number, color: number) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(edge);
  header.writeUInt32BE(edge, 4);
  header.set([8, 2], 8);
  const rows = Buffer.alloc((edge * 3 + 1) * edge);
  rows[1] = color;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const fixture = {
  icon_192: png(192, 31),
  icon_512: png(512, 202),
  maskable_512: png(512, 97),
};
const url =
  "https://academy.example.invalid/functions/v1/files?mode=academy-pwa-icon";
function multipart() {
  const form = new FormData();
  for (const [variant, bytes] of Object.entries(fixture)) {
    form.set(
      variant,
      new File([new Uint8Array(bytes)], `${variant}.png`, {
        type: "image/png",
      }),
    );
  }
  return form;
}
function request(form = multipart(), version = "7") {
  return new Request(`${url}&expected_version=${version}`, {
    method: "POST",
    body: form,
  });
}
function handler(
  state: { checks?: string[]; scans?: (string | boolean)[]; publish?: string } =
    {},
) {
  const calls: string[] = [];
  const input: unknown[] = [];
  let checks = 0, scans = 0;
  const upload = (request: Request) =>
    uploadAcademyPwaIcon(request, {
      check: (version) => {
        calls.push(`check-${version}`);
        const code = state.checks?.[checks++];
        return Promise.resolve({ error: code ? { code } : null });
      },
      scan: (bytes) => {
        calls.push("scan");
        input.push(Buffer.from(bytes).toString("base64"));
        const stateValue = state.scans?.[scans++];
        return stateValue === "throw"
          ? Promise.reject(new Error("scanner unavailable"))
          : Promise.resolve({
            clean: stateValue !== false,
            version: String(stateValue ?? "ClamAV 1 fixture"),
          });
      },
      publish: (version, icons) => {
        calls.push(`publish-${version}`);
        input.push(icons);
        return Promise.resolve({
          error: state.publish ? { code: state.publish } : null,
          data: { installation_id: "fictional", version: 8, custom: true },
        });
      },
    }, (status, data) => Response.json(data, { status }));
  return { upload, calls, input };
}

Deno.test("PWA icon requires three exact canonical PNGs, scans all exact bytes and rechecks the version before publication", async () => {
  const { upload, calls, input } = handler();
  const response = await upload(request());
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    installation_id: "fictional",
    version: 8,
    custom: true,
  });
  assertEquals(calls, [
    "check-7",
    "scan",
    "scan",
    "scan",
    "check-7",
    "publish-7",
  ]);
  const icon_192 = fixture.icon_192.toString("base64");
  const icon_512 = fixture.icon_512.toString("base64");
  const maskable_512 = fixture.maskable_512.toString("base64");
  assertEquals(input, [
    icon_192,
    icon_512,
    maskable_512,
    {
      icon_192,
      icon_512,
      maskable_512,
      scanners: Array(3).fill("ClamAV 1 fixture"),
    },
  ]);
});

Deno.test("PWA icon declines wrong dimensions, forged form, and both byte limits before any scan", async () => {
  const wrongField = multipart();
  wrongField.append("icon_192", "duplicate");
  const missingIcon = multipart();
  missingIcon.delete("maskable_512");
  missingIcon.set("extra", "replacement");
  const wrongDimensions = multipart();
  wrongDimensions.set(
    "maskable_512",
    new File([new Uint8Array(fixture.icon_192)], "wrong.png", {
      type: "image/png",
    }),
  );
  const oversizeVariant = multipart();
  oversizeVariant.set(
    "icon_192",
    new File([new Uint8Array(262_145)], "large.png", { type: "image/png" }),
  );
  const oversizeBody = multipart();
  oversizeBody.set(
    "icon_192",
    new File([new Uint8Array(3_000_000)], "huge.png", { type: "image/png" }),
  );
  const badMime = multipart();
  badMime.set(
    "icon_192",
    new File([new Uint8Array(fixture.icon_192)], "wrong.jpg", {
      type: "image/jpeg",
    }),
  );
  for (
    const [form, status, error] of [
      [wrongField, 400, "invalid_request"],
      [missingIcon, 400, "invalid_request"],
      [wrongDimensions, 415, "invalid_icon"],
      [oversizeVariant, 413, "file_size"],
      [oversizeBody, 413, "file_size"],
      [badMime, 415, "unsupported_type"],
    ] as const
  ) {
    const harness = handler();
    const response = await harness.upload(request(form));
    assertEquals(response.status, status);
    assertEquals(await response.json(), { error });
    assertEquals(harness.calls, ["check-7"]);
  }
  const harness = handler();
  assertEquals(
    (await harness.upload(request(multipart(), "7&expected_version=8"))).status,
    400,
  );
  assertEquals(harness.calls, []);
});

Deno.test("PWA icon never publishes incomplete scanner results or revoked writes and preserves safe conflicts", async () => {
  for (
    const [state, responseStatus, error, calls] of [
      [{ checks: ["42501"] }, 403, "access_denied", ["check-7"]],
      [{ scans: ["ClamAV 1", false] }, 422, "scan_rejected", [
        "check-7",
        "scan",
        "scan",
      ]],
      [{ scans: ["ClamAV 1", "throw"] }, 503, "scanner_unavailable", [
        "check-7",
        "scan",
        "scan",
      ]],
      [{ checks: ["", "PT409"] }, 409, "icon_changed", [
        "check-7",
        "scan",
        "scan",
        "scan",
        "check-7",
      ]],
      [{ checks: ["", "42501"] }, 403, "access_denied", [
        "check-7",
        "scan",
        "scan",
        "scan",
        "check-7",
      ]],
      [{ publish: "PT409" }, 409, "icon_changed", [
        "check-7",
        "scan",
        "scan",
        "scan",
        "check-7",
        "publish-7",
      ]],
    ] satisfies [Parameters<typeof handler>[0], number, string, string[]][]
  ) {
    const harness = handler(state);
    const response = await harness.upload(request());
    assertEquals(response.status, responseStatus);
    assertEquals(await response.json(), { error });
    assertEquals(harness.calls, calls);
  }
});
