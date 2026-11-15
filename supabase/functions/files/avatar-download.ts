import { MAX_AVATAR_SIZE, validateAvatar } from "./avatar.ts";

interface AvatarVersion {
  id: string;
  document_id: string;
  object_path: string;
  status: string;
  mime_type: string;
  size_bytes: number;
}
interface AvatarDocument {
  owner_id: string;
  scope: string;
  kind: string;
  deleted_at: string | null;
}
interface AvatarDependencies {
  selection: (target: string) => Promise<{ version_id: string } | null>;
  version: (id: string) => Promise<AvatarVersion | null>;
  document: (id: string) => Promise<AvatarDocument | null>;
  download: (path: string) => Promise<Uint8Array | null>;
}

/** No Storage URL or general personal-document grant is returned. The caller
 * adapter uses the user's SQL projection for selection/visibility, and a
 * server-only client solely for reading the selected exact clean object. */
export async function selectedAvatarBytes(
  target: string,
  dependencies: AvatarDependencies,
): Promise<Uint8Array> {
  const selected = await dependencies.selection(target);
  if (!selected) throw new Error("avatar_unavailable");
  const version = await dependencies.version(selected.version_id);
  if (
    !version ||
    version.id !== selected.version_id ||
    version.status !== "clean" ||
    version.mime_type !== "image/png" ||
    version.size_bytes > MAX_AVATAR_SIZE
  )
    throw new Error("avatar_unavailable");
  const document = await dependencies.document(version.document_id);
  if (
    !document ||
    document.owner_id !== target ||
    document.scope !== "personal" ||
    document.kind !== "avatar" ||
    document.deleted_at
  )
    throw new Error("access_denied");
  const bytes = await dependencies.download(version.object_path);
  if (!bytes) throw new Error("avatar_unavailable");
  await validateAvatar(bytes);
  // Membership, suspension and selection may change during the Storage read.
  // The same target must still expose this exact version before any byte leaves.
  const current = await dependencies.selection(target);
  if (current?.version_id !== version.id) throw new Error("access_denied");
  return bytes;
}
