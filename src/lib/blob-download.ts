/** Browser delivery and cleanup for bytes already authorized by the caller. */

/** Start a download and keep the temporary URL alive long enough for navigation to consume it. */
export function saveBlob(blob: Blob, filename: string) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  try {
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
