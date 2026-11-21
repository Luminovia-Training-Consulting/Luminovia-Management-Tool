import { assertEquals, assertStrictEquals } from "jsr:@std/assert@1.0.15";
import {
  academyLogoVersion,
  logoMaxBytes,
  verifyAcademyLogo,
} from "./academy-logo.ts";

const fixture = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQTDkBAAHfAUZ76qvRAAAAAElFTkSuQmCC",
  ),
  (value) => value.charCodeAt(0),
);

Deno.test("academy logo requires an exact single revision and fixed intake mode", () => {
  assertEquals(
    academyLogoVersion(
      new URLSearchParams("mode=academy-logo&expected_version=0"),
    ),
    0,
  );
  for (
    const query of [
      "mode=academy-logo",
      "mode=academy-logo&expected_version=01",
      "mode=academy-logo&expected_version=0&expected_version=1",
      "mode=academy-logo&expected_version=2147483648",
    ]
  ) {
    assertEquals(academyLogoVersion(new URLSearchParams(query)), null);
  }
});

Deno.test("academy logo scans the same checked bytes and fails closed before promotion", async () => {
  let scanned = 0;
  const scanner = (bytes: Uint8Array) => {
    assertStrictEquals(bytes, fixture);
    scanned++;
    return Promise.resolve({ clean: true, version: "ClamAV 1 fixture" });
  };
  const corrupted = fixture.slice();
  corrupted[45] ^= 1;
  assertEquals(await verifyAcademyLogo(corrupted, scanner), 415);
  assertEquals(
    await verifyAcademyLogo(new Uint8Array(logoMaxBytes + 1), scanner),
    415,
  );
  assertEquals(scanned, 0);
  assertEquals(await verifyAcademyLogo(fixture, scanner), {
    version: "ClamAV 1 fixture",
  });
  assertEquals(scanned, 1);
  assertEquals(
    await verifyAcademyLogo(
      fixture,
      () => Promise.resolve({ clean: false, version: "fixture" }),
    ),
    422,
  );
  assertEquals(
    await verifyAcademyLogo(
      fixture,
      () => Promise.reject(new Error("scanner unavailable")),
    ),
    503,
  );
});
