/** Release only the exact clean PDF allowed by the caller's company contract projection. */
import {sha256FileHex} from '../_shared/file-bytes.ts';

interface Selection {
    document_id: string;
    version_id: string;
    sha256: string;
    file_name: string;
}

interface Version {
    id: string;
    document_id: string;
    object_path: string;
    status: string;
    mime_type: string;
    size_bytes: number;
    sha256: string | null;
}

interface Dependencies {
    selection: (id: string) => Promise<Selection | null>;
    version: (id: string) => Promise<Version | null>;
    download: (path: string) => Promise<Blob | null>;
}

/** Recheck the caller's current grant after fetching and verifying the bounded object. */
export async function organisationContractBytes(id: string, maxBytes: number, deps: Dependencies) {
    const selected = await deps.selection(id);
    if (!selected || selected.document_id !== id) throw new Error('access_denied');
    const version = await deps.version(selected.version_id);
    if (!version || version.document_id !== id || version.id !== selected.version_id ||
        version.status !== 'clean' || version.mime_type !== 'application/pdf' ||
        version.sha256 !== selected.sha256 || !/^[a-f0-9]{64}$/.test(selected.sha256) ||
        !Number.isSafeInteger(version.size_bytes) || version.size_bytes < 1 || version.size_bytes > maxBytes) {
        throw new Error('access_denied');
    }
    const object = await deps.download(version.object_path);
    if (!object || object.size !== version.size_bytes) throw new Error('access_denied');
    const bytes = await object.arrayBuffer();
    if (await sha256FileHex(bytes) !== selected.sha256) throw new Error('access_denied');
    const current = await deps.selection(id);
    if (!current || current.document_id !== id || current.version_id !== version.id ||
        current.sha256 !== selected.sha256 || current.file_name !== selected.file_name) {
        throw new Error('access_denied');
    }
    return {bytes, name: selected.file_name};
}