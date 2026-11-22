/** Signed, minimal operator handoff for one approved Academy runtime. */
import {
  createHash,
  createPublicKey,
  KeyObject,
  sign,
  verify,
} from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

const domain = "Luminovia Academy Runtime Handoff v1\n";
const targetSchema = z.strictObject({
  installation_id: z.uuid().refine((value) => value === value.toLowerCase()),
  edition: z.enum(["customer-self-hosted", "customer-managed"]),
  portal_origin: z.string().max(261),
  runtime_directory: z.string().max(240),
  source_revision: z.string().regex(/^[0-9a-f]{40}$/),
});
const envelopeSchema = z.strictObject({
  version: z.literal(1),
  target: targetSchema,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});

const payload = (target) => Buffer.from(domain + JSON.stringify(target));
const encode = (envelope) => JSON.stringify(envelope) + "\n";

export function signAcademyRuntimeHandoff(input, key) {
  const target = targetSchema.parse(input);
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519")
    throw new Error("Use an Ed25519 private key to sign the runtime handoff.");
  return encode({
    version: 1,
    target,
    signature: sign(null, payload(target), key).toString("base64url"),
  });
}

export function verifyAcademyRuntimeHandoff(bytes, trustedKey) {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const envelope = envelopeSchema.parse(JSON.parse(source));
  const key =
    trustedKey instanceof KeyObject ? trustedKey : createPublicKey(trustedKey);
  const signature = Buffer.from(envelope.signature, "base64url");
  const contents = payload(envelope.target);
  if (
    key.type !== "public" ||
    key.asymmetricKeyType !== "ed25519" ||
    encode(envelope) !== source ||
    signature.toString("base64url") !== envelope.signature ||
    !verify(null, contents, key, signature)
  )
    throw new Error("academy_runtime_handoff_signature");
  return {
    target: envelope.target,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

/** Validate and read the same bounded operator-file descriptor. */
export function readRuntimeHandoffFile(path, privateFile = true) {
  if (
    !isAbsolute(path) ||
    resolve(path) !== path ||
    realpathSync(path) !== path
  )
    throw new Error("academy_runtime_handoff_path");
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(descriptor, { bigint: true });
    const user = BigInt(process.getuid());
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size < 1n ||
      before.size > 16_384n ||
      (privateFile
        ? before.uid !== user || (before.mode & 0o077n) !== 0n
        : (before.uid !== user && before.uid !== 0n) ||
          (before.mode & 0o022n) !== 0n)
    )
      throw new Error("academy_runtime_handoff_file");
    const bytes = Buffer.alloc(Number(before.size));
    let position = 0;
    while (position < bytes.length) {
      const count = readSync(
        descriptor,
        bytes,
        position,
        bytes.length - position,
      );
      if (!count) throw new Error("academy_runtime_handoff_changed");
      position += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    )
      throw new Error("academy_runtime_handoff_changed");
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}
