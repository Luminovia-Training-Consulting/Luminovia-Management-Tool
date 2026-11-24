/** Only the authorized job and its catalogue determine the private object path. */
import {sha256FileHex} from "../_shared/file-bytes.ts";
type Source = { sha256: string; file_name: string };
type JobSourceDependencies = {
  select: () => Promise<Source | null>;
  exists: (path: string) => Promise<boolean>;
  download: (path: string) => Promise<Blob | null>;
};

export async function readJobSource(availabilityOnly: boolean, deps: JobSourceDependencies) {
  const source = await deps.select();
  if (!source || !/^[a-f0-9]{64}$/.test(source.sha256))
    return { status: 403 } as const;
  const path = `course-sources/${source.sha256}.pdf`;
  if (availabilityOnly)
    return { status: await deps.exists(path) ? 204 : 404 } as const;

  const file = await deps.download(path);
  if (!file) return { status: 404 } as const;
  if (!file.size || file.size > 10 * 1024 * 1024)
    return { status: 409 } as const;
  const bytes = await file.arrayBuffer();
  const actual = await sha256FileHex(bytes);
  if (actual !== source.sha256) return { status: 409 } as const;

  const current = await deps.select();
  if (current?.sha256 !== source.sha256 || current.file_name !== source.file_name)
    return { status: 403 } as const;
  return { status: 200, bytes, name: source.file_name } as const;
}
