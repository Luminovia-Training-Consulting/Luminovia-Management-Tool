import {MAX_FILE_SIZE} from './validation.ts';

interface Selection {
    id: string;
    user_id: string;
    document_id: string;
    version_id: string;
    sha256: string
}

interface Version {
    id: string;
    document_id: string;
    object_path: string;
    status: string;
    mime_type: string;
    original_name: string;
    size_bytes: number;
    sha256: string | null
}

interface Document {
    owner_id: string;
    scope: string;
    kind: string;
    deleted_at: string | null
}

export interface QualificationDownloadDependencies {
    selection: (id: string) => Promise<Selection | null>;
    version: (id: string) => Promise<Version | null>;
    document: (id: string) => Promise<Document | null>;
    download: (path: string) => Promise<Uint8Array | null>;
}

/** A revocable topic grant releases one immutable version, never a document's
 * later replacements or general personal-file access. Both ACL checks run with
 * the actual caller's JWT; only the bounded object fetch uses server authority. */
export async function qualificationEvidenceBytes(id: string, deps: QualificationDownloadDependencies) {
    const selected = await deps.selection(id);
    if (!selected || selected.id !== id) throw new Error('access_denied');
    const version = await deps.version(selected.version_id);
    if (!version || version.id !== selected.version_id || version.document_id !== selected.document_id || version.status !== 'clean' || version.sha256 !== selected.sha256 || version.size_bytes < 1 || version.size_bytes > MAX_FILE_SIZE) throw new Error('access_denied');
    const document = await deps.document(version.document_id);
    if (!document || document.owner_id !== selected.user_id || document.scope !== 'personal' || document.kind !== 'certificate' || document.deleted_at) throw new Error('access_denied');
    const bytes = await deps.download(version.object_path);
    if (!bytes || bytes.length !== version.size_bytes) throw new Error('access_denied');
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))).map(value => value.toString(16).padStart(2, '0')).join('');
    if (digest !== selected.sha256) throw new Error('access_denied');
    const current = await deps.selection(id);
    if (!current || current.id !== id || current.user_id !== selected.user_id || current.version_id !== version.id || current.document_id !== version.document_id || current.sha256 !== digest) throw new Error('access_denied');
    return {bytes, mime_type: version.mime_type, original_name: version.original_name};
}