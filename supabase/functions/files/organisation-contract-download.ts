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

/** Read no more than the already-authorized byte count from private Storage. */
export async function readExpectedBytes(object: Blob, expectedSize: number) {
    const bytes = new Uint8Array(expectedSize);
    const reader = object.stream().getReader();
    let offset = 0;
    try {
        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            if (value.byteLength > expectedSize - offset) {
                await reader.cancel();
                throw new Error('access_denied');
            }
            bytes.set(value, offset);
            offset += value.byteLength;
        }
    } catch (error) {
        if (error instanceof Error && error.message === 'access_denied') throw error;
        try {
            await reader.cancel();
        } catch {
            // Preserve the fail-closed response when the underlying stream has failed.
        }
        throw new Error('access_denied');
    } finally {
        reader.releaseLock();
    }
    if (offset !== expectedSize) throw new Error('access_denied');
    return bytes;
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
    if (!object) throw new Error('access_denied');
    const bytes = await readExpectedBytes(object, version.size_bytes);
    if (await sha256FileHex(bytes) !== selected.sha256) throw new Error('access_denied');
    const current = await deps.selection(id);
    if (!current || current.document_id !== id || current.version_id !== version.id ||
        current.sha256 !== selected.sha256 || current.file_name !== selected.file_name) {
        throw new Error('access_denied');
    }
    return {bytes, name: selected.file_name};
}
