import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";

interface AvatarSelection {
  version_id: string;
  updated_at: string;
}
export const avatarQuery = (actor: string, target: string) =>
  queryOptions({
    queryKey: ["avatar", actor, target],
    queryFn: async ({ signal }) => {
      const result = await db()
        .rpc("profile_avatar", { p_user_id: target })
        .abortSignal(signal);
      if (result.error) throw result.error;
      return result.data as AvatarSelection | null;
    },
    retry: false,
    staleTime: 30000,
    refetchInterval: 30000,
    gcTime: 0,
  });

export async function selectAvatar(versionId: string | null) {
  requireOnline();
  const result = await db().rpc("set_profile_avatar", {
    p_version_id: versionId,
  });
  if (result.error) throw result.error;
}

export async function readAvatar(
  target: string,
  signal: AbortSignal,
): Promise<Blob> {
  requireOnline();
  const auth = await db().auth.getSession();
  if (auth.error || !auth.data.session)
    throw new Error("authentication_required");
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/files`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.data.session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ action: "avatar", user_id: target }),
      signal,
      cache: "no-store",
    },
  );
  if (!response.ok || response.headers.get("Content-Type") !== "image/png")
    throw new Error("avatar_unavailable");
  return await response.blob();
}

/** Check encoded dimensions before asking the browser to decode the image.
 * The output is a newly rasterised PNG; EXIF, filenames and other source
 * metadata are not copied into the private, scanned avatar document. */
export function sourceImageSize(
  bytes: Uint8Array,
  mime: string,
): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0;
  if (
    mime === "image/png" &&
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
  ) {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at] !== 255) break;
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (at + 2 > bytes.length) break;
      const length = view.getUint16(at);
      if (length < 2 || at + length > bytes.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker) &&
        length >= 8
      ) {
        height = view.getUint16(at + 3);
        width = view.getUint16(at + 5);
        break;
      }
      at += length;
    }
  } else if (
    mime === "image/webp" &&
    bytes.length >= 25 &&
    new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP"
  ) {
    const type = new TextDecoder().decode(bytes.subarray(12, 16));
    if (type === "VP8X" && bytes.length >= 30 && !(bytes[20] & 2)) {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (
      type === "VP8 " &&
      bytes.length >= 30 &&
      bytes[23] === 157 &&
      bytes[24] === 1 &&
      bytes[25] === 42
    ) {
      width = view.getUint16(26, true) & 16383;
      height = view.getUint16(28, true) & 16383;
    } else if (type === "VP8L" && bytes[20] === 47) {
      const bits = view.getUint32(21, true);
      width = (bits & 16383) + 1;
      height = ((bits >>> 14) & 16383) + 1;
    }
  }
  if (
    !width ||
    !height ||
    width > 8192 ||
    height > 8192 ||
    width * height > 16000000
  )
    throw new Error("avatar_image_invalid");
  return [width, height];
}

export async function prepareAvatar(file: File): Promise<File> {
  if (
    file.size < 1 ||
    file.size > 10 * 1024 * 1024 ||
    !["image/png", "image/jpeg", "image/webp"].includes(file.type)
  )
    throw new Error("avatar_image_invalid");
  sourceImageSize(new Uint8Array(await file.arrayBuffer()), file.type);
  const image = await createImageBitmap(file);
  try {
    if (
      image.width * image.height > 16000000 ||
      image.width > 8192 ||
      image.height > 8192
    )
      throw new Error("avatar_image_invalid");
    const side = Math.min(512, image.width, image.height);
    const sourceSide = Math.min(image.width, image.height);
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("avatar_image_invalid");
    context.drawImage(
      image,
      (image.width - sourceSide) / 2,
      (image.height - sourceSide) / 2,
      sourceSide,
      sourceSide,
      0,
      0,
      side,
      side,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error("avatar_image_invalid")),
        "image/png",
      ),
    );
    if (blob.size > 2 * 1024 * 1024) throw new Error("avatar_image_invalid");
    return new File([blob], "avatar.png", { type: "image/png" });
  } finally {
    image.close();
  }
}
