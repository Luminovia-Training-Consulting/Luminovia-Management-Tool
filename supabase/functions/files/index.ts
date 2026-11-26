/**
 * Authenticated file gateway: reserve under caller permissions, store immutable
 * quarantine bytes, scan and promote explicitly. Downloads recheck current
 * resource access around Storage reads; qualification evidence has its own
 * exact-version authorization context.
 */
import {sha256FileHex, webFileBytes} from '../_shared/file-bytes.ts';
import {boundedBytes, boundedFormData, boundedJson, RequestBodyTooLarge} from '../_shared/bounded-body.ts';
import {qualificationEvidenceBytes} from './qualification-download.ts';
import {organisationContractBytes, readExpectedBytes} from './organisation-contract-download.ts';
import {withUploadLease} from './deletion-lease.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.119.0';
import {scan} from './clamav.ts';
import {validateAvatar} from './avatar.ts';
import {uploadAcademyPwaIcon} from './academy-pwa-icon.ts';
import {academyLogoVersion, verifyAcademyLogo, logoMaxBytes} from './academy-logo.ts';
import {serveAcademyPwaAsset} from './academy-pwa-assets.ts';
import {selectedAvatarBytes} from './avatar-download.ts';
import {readJobSource} from './job-source.ts';
import {assignmentSubmissionQuery, academyAnswerKeyQuery, academyAttendanceQuery, academyAttendanceSession, academyChatRoom, academyCourseChatQuery, academyMaterialCourse, academyMaterialMaxBytes, academyMaterialQuery, academyStudentExamQuery, courseScormQuery, courseH5pQuery, courseArchiveRun, courseSubmissionQuery, courseSubmissionRun} from './academy-material.ts';
import {downloadDisposition, MAX_FILE_SIZE, safeName, validateFile} from './validation.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// The administration client operates only after explicit caller-scoped permission checks.
const service = createClient(url, secret, {auth: {persistSession: false, autoRefreshToken: false}});
const origins = (Deno.env.get('PORTAL_ALLOWED_ORIGINS') ?? '').split(',').map(v => v.trim()).filter(Boolean);
// Validate an input UUID's format; a valid identifier grants no access.
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// Document metadata visible through caller-scoped RLS; service-client access alone must not determine visibility.
interface Document {
    id: string;
    owner_id: string;
    scope: string;
    kind: string;
    room_id: string | null;
    job_id: string | null;
    original_name: string;
    mime_type: string;
    size_bytes: number;
    status: string;
    current_version_id: string;
    deleted_at: string | null
}

const scanPortalFile = (bytes: Uint8Array) =>
    scan(bytes, Deno.env.get('PORTAL_CLAMAV_HOST') ?? '', Number(Deno.env.get('PORTAL_CLAMAV_PORT') ?? 3310), {url: Deno.env.get('PORTAL_SCANNER_URL'), token: Deno.env.get('PORTAL_SCANNER_TOKEN')});

// Each request owns its user client; never share Auth state or other sessions between requests.
Deno.serve(async (request: Request) => {
    const requestUrl = new URL(request.url);
    const publicAsset = await serveAcademyPwaAsset(request.method, requestUrl.searchParams, {
        manifest: async () => {
            const {data, error} = await service.rpc('academy_pwa_manifest', {}, {get: true});
            if (error) throw error;
            return data;
        },
        image: async (variant, version) => {
            const {data, error} = await service.rpc('read_academy_pwa_icon', {p_variant: variant, p_version: version});
            if (error) throw error;
            return data;
        },
    });
    if (publicAsset) return publicAsset;
    const origin = request.headers.get('origin') ?? '';
    const headers: Record<string, string> = {'Cache-Control': 'no-store, private', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Vary': 'Origin'};
    if (origins.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Headers'] = 'authorization,apikey,content-type,x-client-info';
        headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
        headers['Access-Control-Expose-Headers'] = 'Content-Disposition,X-Avatar-Version';
    }
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers: {...headers, 'Content-Type': 'application/json'}});
    if (!origins.includes(origin)) return json(403, {error: 'origin_not_allowed'});
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers});
    if (request.method !== 'POST') return json(405, {error: 'method_not_allowed'});
    const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token) return json(401, {error: 'authentication_required'});
    const user = createClient(url, anon, {global: {headers: {Authorization: `Bearer ${token}`}}, auth: {persistSession: false, autoRefreshToken: false}});
    try {
        const auth = await user.auth.getUser(token);
        if (auth.error || !auth.data.user) return json(401, {error: 'authentication_required'});
        const actor = auth.data.user.id;
        const requireProfile = async () => {
            const profile = await user.from('profiles').select('id,active').eq('id', actor).maybeSingle();
            if (profile.error || !profile.data?.active) throw new Error('access_denied');
        };
        if (requestUrl.searchParams.get('mode') === 'academy-pwa-icon') {
            return await uploadAcademyPwaIcon(request, {
                check: (version) => user.rpc('check_academy_pwa_icon_write', {p_expected_version: version}),
                scan: scanPortalFile,
                publish: (version, icons) => service.rpc('publish_academy_scanned_pwa_icon', {
                    p_actor: actor, p_expected_version: version,
                    p_icon_192_base64: icons.icon_192,
                    p_icon_512_base64: icons.icon_512,
                    p_maskable_512_base64: icons.maskable_512,
                    p_scanners: icons.scanners,
                }),
            }, json);
        }
        if (requestUrl.searchParams.get('mode') === 'academy-logo') {
            const version = academyLogoVersion(requestUrl.searchParams);
            if (version === null) return json(400, {error: 'invalid_request'});
            if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'image/png') return json(415, {error: 'unsupported_type'});
            const check = () => user.rpc('check_academy_logo_write', {p_expected_version: version});
            const authorization = (error: {code: string}) => error.code === 'PT409'
                ? json(409, {error: 'logo_changed'})
                : error.code === '42501'
                    ? json(403, {error: 'access_denied'})
                    : json(503, {error: 'upload_failed'});
            const before = await check();
            if (before.error) return authorization(before.error);
            const bytes = await boundedBytes(request, logoMaxBytes);
            const verdict = await verifyAcademyLogo(bytes, scanPortalFile);
            if (typeof verdict === 'number') {
                if (verdict === 503) return json(503, {error: 'scanner_unavailable'});
                if (verdict === 422) return json(422, {error: 'scan_rejected'});
                return json(415, {error: 'invalid_logo'});
            }
            const after = await check();
            if (after.error) return authorization(after.error);
            const published = await service.rpc('publish_academy_scanned_logo', {
                p_actor: actor, p_expected_version: version,
                p_png_hex: Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''),
                p_scanner: verdict.version,
            });
            if (published.error) return ['PT409', '42501'].includes(published.error.code)
                ? authorization(published.error) : json(503, {error: 'upload_failed'});
            return json(200, published.data);
        }
        const query = requestUrl.search;
        const examReservation = query === academyStudentExamQuery ? 'reserve_academy_student_exam_pdf'
            : query === academyAnswerKeyQuery ? 'reserve_academy_answer_key_pdf' : null;
        const academyChat = query === academyCourseChatQuery;
        const academyAttendance = query === academyAttendanceQuery;
        const academyIntake = academyChat || academyAttendance || examReservation !== null || query === academyMaterialQuery;
        const examSubmission = query === '?mode=exam-submission';
        const assignmentSubmission = query === assignmentSubmissionQuery;
        const portfolioUpload = query === '?mode=portfolio-evidence';
        const archiveFormat = query === courseScormQuery ? "scorm" : query === courseH5pQuery ? "h5p" : null;
        const submissionIntake = query === courseSubmissionQuery || examSubmission || assignmentSubmission;
        const scopedIntake = academyIntake || submissionIntake || portfolioUpload || archiveFormat !== null;
        const multipart = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() === 'multipart/form-data';
        if (scopedIntake && !multipart) return json(400, {error: 'invalid_request'});
        if (scopedIntake) {
            const access = await user.rpc('portal_access');
            if (access.error || access.data !== true) throw new Error('access_denied');
        } else await requireProfile();
        const visible = async (id: string) => {
            const r = await user.from('documents').select('*').eq('id', id).maybeSingle();
            if (r.error || !r.data) throw new Error('access_denied');
            return r.data as Document;
        };
        // Upload flow validates bounded actual bytes/formats before reserving a database-authorized version.
        if (multipart) {
            const form = await boundedFormData(request, (scopedIntake ? academyMaterialMaxBytes : MAX_FILE_SIZE) + 16384);
            if (portfolioUpload && (
                [...form.keys()].some((field) => field !== 'file' && field !== 'client_id') ||
                form.getAll('file').length !== 1 || form.getAll('client_id').length !== 1
            )) return json(400, {error: 'invalid_request'});
            const company = form.get('contract_organisation_id');
            const companyUpload = form.get('kind') === 'organisation_contract';
            if (companyUpload || company !== null) {
                const allowedFields = ['file', 'kind', 'client_id', 'contract_organisation_id'];
                if (!companyUpload || !uuid(company) || query !== '' ||
                    [...form.keys()].some((field) => !allowedFields.includes(field)) ||
                    allowedFields.some((field) => form.getAll(field).length !== 1)) {
                    return json(400, {error: 'invalid_request'});
                }
            }
            const materialRun = academyMaterialCourse(form, academyIntake && !academyChat && !academyAttendance);
            const chatRoom = academyChatRoom(form, academyChat);
            const attendanceSession = academyAttendanceSession(form, academyAttendance);
            const submissionRun = courseSubmissionRun(form, submissionIntake, assignmentSubmission);
            const archiveRun = courseArchiveRun(form, archiveFormat);
            const assignmentId = form.get('assignment_id');
            if (assignmentSubmission ? !uuid(assignmentId) : assignmentId !== null) return json(400, {error: 'invalid_request'});
            const protectedUpload = Boolean(materialRun || chatRoom || attendanceSession || submissionRun);
            const file = form.get('file');
            if (!(file instanceof File)) return json(400, {error: 'invalid_request'});
            const name = safeName(file.name);
            if (!name) return json(400, {error: 'invalid_request'});
            if (file.size > (scopedIntake ? academyMaterialMaxBytes : MAX_FILE_SIZE)) return json(413, {error: 'file_size'});
            const bytes = new Uint8Array(await file.arrayBuffer());
            const mime = await validateFile(bytes, name, file.type, archiveFormat);
            if ((examReservation || attendanceSession) && mime !== 'application/pdf') return json(415, {error: 'unsupported_type'});
            const incomingDigest = await sha256FileHex(bytes);
            const clientId = form.get('client_id');
            if (!uuid(clientId)) return json(400, {error: 'invalid_request'});
            const scope = String(form.get('scope') ?? 'personal');
            const kind = String(form.get('kind') ?? (scope === 'room' ? 'chat' : 'material'));
            if ((kind === 'invoice' || companyUpload) && mime !== 'application/pdf') return json(415, {error: 'unsupported_type'});
            if (kind === 'avatar') await validateAvatar(bytes);
            const roomId = chatRoom ?? (form.get('room_id') || null);
            const jobId = form.get('job_id') || null;
            const replaceId = form.get('replace_id') || null;
            const ownerId = form.get('owner_id') || null;
            if ((roomId && !uuid(roomId)) || (jobId && !uuid(jobId)) || (replaceId && !uuid(replaceId)) || (ownerId && !uuid(ownerId))) return json(400, {error: 'invalid_request'});
            // Owner/scope inputs identify targets only. RPCs enforce current permissions, quotas and idempotency.
            const messageOnly = form.get('message_only');
            if (messageOnly !== null && (messageOnly !== 'true' || scope !== 'room' || kind !== 'chat' || !roomId || jobId || replaceId || ownerId)) return json(400, {error: 'invalid_request'});
            const courseChat = form.get('course_chat');
            if (courseChat !== null && (courseChat !== 'true' || messageOnly !== 'true')) return json(400, {error: 'invalid_request'});
            const reserved = archiveRun
                ? await user.rpc(archiveFormat === 'h5p' ? 'reserve_course_h5p_package' : 'reserve_course_scorm_package', {
                    p_run_id: archiveRun, p_name: name, p_size: bytes.length, p_client_id: clientId, p_sha256: incomingDigest,
                })
                : portfolioUpload
                ? await user.rpc('reserve_learning_portfolio_evidence', {
                    p_name: name, p_mime: mime, p_size: bytes.length, p_client_id: clientId, p_sha256: incomingDigest,
                })
                : companyUpload
                ? await user.rpc('reserve_organisation_contract', {p_organisation_id: company, p_name: name, p_size: bytes.length, p_client_id: clientId, p_sha256: incomingDigest})
                : submissionRun
                ? await user.rpc(assignmentSubmission ? 'reserve_course_assignment_submission'
                    : examSubmission ? 'reserve_course_exam_submission' : 'reserve_course_submission', {
                    p_run_id: submissionRun, p_name: name, p_mime: mime, p_size: bytes.length,
                    p_client_id: clientId, p_sha256: incomingDigest,
                    ...(assignmentSubmission ? {p_assignment_id: assignmentId} : {}),
                })
                : attendanceSession
                ? await user.rpc('reserve_academy_attendance_pdf', {p_session_id: attendanceSession, p_name: name, p_size: bytes.length, p_client_id: clientId, p_sha256: incomingDigest})
                : chatRoom
                ? await user.rpc('reserve_academy_course_chat_file', {p_room_id: chatRoom, p_name: name, p_mime: mime, p_size: bytes.length, p_client_id: clientId, p_sha256: incomingDigest})
                : materialRun && examReservation
                ? await user.rpc(examReservation, {p_run_id: materialRun, p_name: name, p_size: bytes.length, p_client_id: clientId, p_sha256: incomingDigest})
                : materialRun
                ? await user.rpc('reserve_academy_course_material', {p_run_id: materialRun, p_name: name, p_mime: mime, p_size: bytes.length, p_client_id: clientId, p_sha256: incomingDigest})
                : messageOnly === 'true'
                ? await user.rpc(courseChat === 'true' ? 'reserve_course_chat_document' : 'reserve_message_document', {p_name: name, p_mime: mime, p_size: bytes.length, p_room_id: roomId, p_client_id: clientId})
                : await user.rpc('reserve_document', {p_name: name, p_mime: mime, p_size: bytes.length, p_scope: scope, p_kind: kind, p_room_id: roomId, p_job_id: jobId, p_client_id: clientId, p_replace_id: replaceId, p_owner_id: ownerId});
            if (reserved.error) return reserved.error.code === 'PT409'
                ? json(409, {error: 'idempotency_conflict'})
                : json(403, {error: 'upload_not_allowed'});
            const reservation = reserved.data as { document_id: string; version_id: string; object_path: string; status: string };
            if (!uuid(reservation.document_id) || !uuid(reservation.version_id)) return json(503, {error: 'upload_failed'});
            if ((protectedUpload || companyUpload || portfolioUpload || archiveRun) && reservation.object_path !== `${actor}/${reservation.document_id}/${reservation.version_id}`)
                return json(503, {error: 'upload_failed'});
            // Course participants deliberately have no REST access to general document
            // tables. The scoped caller RPC reads only their reservation in this room.
            const courseStatus = async () => {
                const target = submissionRun ? {p_run_id: submissionRun}
                    : attendanceSession ? {p_session_id: attendanceSession}
                    : materialRun ? {p_run_id: materialRun} : {p_room_id: roomId};
                const endpoint = submissionRun ? 'course_submission_status'
                    : attendanceSession ? 'academy_attendance_upload_status'
                    : materialRun ? 'academy_course_material_status' : 'course_chat_upload_status';
                const status = await user.rpc(endpoint, {
                    ...target,
                    p_document_id: reservation.document_id,
                    p_version_id: reservation.version_id,
                });
                if (status.error || !status.data?.document) throw new Error('access_denied');
                return status.data as {document: Document; sha256: string | null};
            };
            const scopedStatus = archiveRun ? async () => {
                const status = await user.rpc(archiveFormat === 'h5p' ? 'course_h5p_upload_status' : 'course_scorm_upload_status', {
                    p_run_id: archiveRun, p_document_id: reservation.document_id, p_version_id: reservation.version_id,
                });
                if (status.error || status.data?.document?.kind !== (archiveFormat === 'h5p' ? 'h5p_package' : 'scorm_package')) throw new Error('access_denied');
                return status.data as {document: Document; sha256: string | null};
            } : portfolioUpload ? async () => {
                const status = await user.rpc('learning_portfolio_evidence_upload_status', {
                    p_document_id: reservation.document_id,
                    p_version_id: reservation.version_id,
                });
                if (status.error || status.data?.document?.kind !== 'portfolio_evidence') throw new Error('access_denied');
                return status.data as {document: Document; sha256: string | null};
            } : companyUpload ? async () => {
                const status = await user.rpc('organisation_contract_upload_status', {
                    p_organisation_id: company,
                    p_document_id: reservation.document_id,
                    p_version_id: reservation.version_id,
                });
                if (status.error || status.data?.document?.kind !== 'organisation_contract') throw new Error('access_denied');
                return status.data as {document: Document; sha256: string | null};
            } : protectedUpload || courseChat === 'true' ? courseStatus : null;
            const scoped = await scopedStatus?.();
            const doc = scoped?.document ?? await visible(reservation.document_id);
            if (doc.current_version_id !== reservation.version_id) return json(409, {error: 'version_superseded'});
            const currentDocument = async () => scopedStatus ? (await scopedStatus()).document : visible(doc.id);
            const requestedVersion = scoped
                ? {data: {sha256: scoped.sha256, status: doc.status}, error: null}
                : await user.from('document_versions').select('sha256,status').eq('id', reservation.version_id).eq('document_id', doc.id).maybeSingle();
            if (requestedVersion.error || !requestedVersion.data) return json(503, {error: 'upload_failed'});
            // A retry must not attach different payload bytes to the same reservation.
            if (requestedVersion.data.sha256 && requestedVersion.data.sha256 !== incomingDigest) return json(409, {error: 'idempotency_conflict'});
            if (doc.status === 'clean') {
                if (requestedVersion.data.status !== 'clean' || !requestedVersion.data.sha256) return json(503, {error: 'upload_failed'});
                return json(200, {document: doc});
            }
            if (doc.status === 'rejected') return json(422, {error: 'scan_rejected', document_id: doc.id});
            const protectedScan = async (action: string, lease: string | null, sha256: string | null, scannerVersion: string | null) => {
                const result = await service.rpc(submissionRun ? 'course_submission_scan' : 'academy_course_material_scan', {
                    p_document_id: doc.id, p_version_id: reservation.version_id, p_action: action,
                    p_lease_id: lease, p_sha256: sha256, p_scanner_version: scannerVersion,
                });
                if (result.error?.code === '42501') throw new Error('access_denied');
                if (result.error || !uuid(result.data) || (lease && lease !== result.data))
                    throw new Error('deletion_unavailable');
                return result.data;
            };
            // The lease starts before the first Storage write and remains held through
            // scanning, promotion and all cleanup. A concurrent deletion cannot complete
            // while this request could still recreate a clean/quarantine object.
            return await withUploadLease({
                begin: async () => {
                    if (protectedUpload) return await protectedScan('begin', null, incomingDigest, null);
                    const r = await service.rpc('deletion_upload_begin', {p_document_id: doc.id, p_version_id: reservation.version_id});
                    if (r.error || typeof r.data !== 'string') throw new Error('access_denied');
                    return r.data;
                },
                end: async (lease) => {
                    if (protectedUpload) {
                        await protectedScan('end', lease, null, null);
                        return;
                    }
                    const r = await service.rpc('deletion_upload_end', {p_lease_id: lease});
                    if (r.error) throw new Error('deletion_unavailable');
                },
            }, async (writes, lease) => {
                // Quarantine is not a download area; upsert:false protects reserved object bytes.
                const quarantineExisting = await service.storage.from('portal-quarantine').info(reservation.object_path);
                if (quarantineExisting.error) {
                    if (!('code' in quarantineExisting.error) || quarantineExisting.error.code !== 'NoSuchKey') return json(503, {error: 'upload_failed'});
                    const acknowledgeQuarantine = writes.begin();
                    const upload = await service.storage.from('portal-quarantine').upload(reservation.object_path, bytes, {contentType: mime, upsert: false, cacheControl: '0'});
                    // Even409 can follow a byte write and asynchronous provider cleanup. Keep
                    // the barrier on any uncertain write; an ordinary retry reads existing
                    // immutable bytes instead of attempting another conflicting upload.
                    if (upload.error) return json(503, {error: 'upload_failed'});
                    acknowledgeQuarantine();
                }
                // Always scan the immutable stored object, including after an uncertain retry.
                const stored = await service.storage.from('portal-quarantine').download(reservation.object_path);
                if (stored.error || !stored.data) return json(503, {error: 'upload_failed'});
                const storedBytes = new Uint8Array(await stored.data.arrayBuffer());
                const digest = await sha256FileHex(storedBytes);
                if (digest !== incomingDigest) return json(409, {error: 'idempotency_conflict'});
                await validateFile(storedBytes, name, mime, archiveFormat);
                if (kind === 'avatar') await validateAvatar(storedBytes);
                if (!protectedUpload) {
                    await service.from('document_versions').update({status: 'scanning'}).eq('id', reservation.version_id);
                    await service.from('documents').update({status: 'scanning'}).eq('id', doc.id).eq('current_version_id', reservation.version_id);
                }
                // Scanner failure remains scan_error. Only an actual clean result reaches promotion.
                let verdict: { clean: boolean; version: string };
                try {
                    verdict = await scanPortalFile(storedBytes);
                } catch {
                    if (protectedUpload) await protectedScan('scan_error', lease, null, null);
                    else {
                        await service.from('document_versions').update({status: 'scan_error'}).eq('id', reservation.version_id);
                        await service.from('documents').update({status: 'scan_error'}).eq('id', doc.id).eq('current_version_id', reservation.version_id);
                    }
                    return json(503, {error: 'scanner_unavailable', document_id: doc.id});
                }
                if (!verdict.clean) {
                    if (protectedUpload) await protectedScan('rejected', lease, digest, verdict.version);
                    else {
                        const rejectedVersion = await service.from('document_versions').update({status: 'rejected', sha256: digest, scanner_version: verdict.version}).eq('id', reservation.version_id);
                        const rejectedDocument = await service.from('documents').update({status: 'rejected'}).eq('id', doc.id).eq('current_version_id', reservation.version_id);
                        const rejectedAudit = await service.from('audit_events').insert({actor_id: actor, action: 'document.scan_rejected', resource_id: doc.id});
                        if (rejectedVersion.error || rejectedDocument.error || rejectedAudit.error) return json(503, {error: 'upload_failed', document_id: doc.id});
                    }
                    return json(422, {error: 'scan_rejected', document_id: doc.id});
                }
                await currentDocument(); // Membership can change while an upload is being scanned.
                if (doc.kind === 'invoice') {
                    const permission = await user.rpc('can_finalize_invoice_upload', {p_document_id: doc.id, p_version_id: reservation.version_id});
                    if (permission.error || permission.data !== true) throw new Error('access_denied');
                }
                // Recheck access after the long scan and promote exactly the stored bytes that were scanned.
                const cleanExisting = await service.storage.from('portal-clean').info(reservation.object_path);
                if (cleanExisting.error) {
                    if (!('code' in cleanExisting.error) || cleanExisting.error.code !== 'NoSuchKey') return json(503, {error: 'upload_failed'});
                    const acknowledgeClean = writes.begin();
                    const clean = await service.storage.from('portal-clean').upload(reservation.object_path, storedBytes, {contentType: mime, upsert: false, cacheControl: '0'});
                    if (clean.error) return json(503, {error: 'upload_failed'});
                    acknowledgeClean();
                } else {
                    const existingBytes = await service.storage.from('portal-clean').download(reservation.object_path);
                    if (existingBytes.error || !existingBytes.data) return json(503, {error: 'upload_failed'});
                    const existingDigest = await sha256FileHex(await existingBytes.data.arrayBuffer());
                    if (existingDigest !== digest) return json(409, {error: 'idempotency_conflict'});
                }
                if (protectedUpload) {
                    try {
                        await protectedScan('clean', lease, digest, verdict.version);
                    } catch (error) {
                        // This lease is the only active writer. A definite authority
                        // rejection did not publish the version, so discard its clean copy.
                        // An uncertain RPC may already have committed and must keep the bytes.
                        if (submissionRun && error instanceof Error && error.message === 'access_denied') {
                            const acknowledgeRemoval = writes.begin();
                            const removed = await service.storage.from('portal-clean').remove([reservation.object_path]);
                            // A failed remote deletion may still finish after this request.
                            // Hold the lease so a retry cannot publish bytes that are being removed.
                            if (removed.error) throw new Error('deletion_unavailable');
                            acknowledgeRemoval();
                        }
                        throw error;
                    }
                }
                else {
                    const action = doc.kind === 'invoice' ? 'complete_invoice_upload' : 'complete_document_upload';
                    const completed = await service.rpc(action, {
                        p_document_id: doc.id, p_version_id: reservation.version_id, p_lease_id: lease,
                        p_sha256: digest, p_scanner_version: verdict.version,
                    });
                    if (completed.error?.code === '42501') throw new Error('access_denied');
                    if (completed.error?.code === 'PT409') return json(409, {error: 'version_superseded'});
                    if (completed.error) return json(503, {error: 'upload_failed'});
                }
                await service.storage.from('portal-quarantine').remove([reservation.object_path]);
                return json(200, {document: await currentDocument()});
            });
        }
        const payload = await boundedJson(request, 4096);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json(400, {error: 'invalid_request'});
        const data = payload as Record<string, unknown>;
        if (data.action === 'job_source_available' || data.action === 'job_source_download') {
            const jobId = data.job_id, sourceId = data.source_id;
            if (!uuid(jobId) || !uuid(sourceId)) return json(400, {error: 'invalid_request'});
            const storage = service.storage.from('portal-clean');
            const result = await readJobSource(data.action === 'job_source_available', {
                select: async () => {
                    const reference = await user.rpc('job_building_block_reference', {p_job_id: jobId});
                    if (reference.error || !reference.data?.building_block_id) return null;
                    const permissions = await user.rpc('get_my_permissions');
                    if (permissions.error) return null;
                    if (!Array.isArray(permissions.data) || !permissions.data.includes('jobs.manage')) {
                        const assignment = await user.from('job_claims').select('id')
                            .eq('job_id', jobId).eq('lecturer_id', actor).eq('status', 'confirmed').limit(1).maybeSingle();
                        if (assignment.error || !assignment.data) return null;
                    }
                    const source = await user.from('building_block_sources').select('sha256,file_name')
                        .eq('id', sourceId).eq('building_block_id', reference.data.building_block_id).maybeSingle();
                    return source.error ? null : source.data;
                },
                exists: async (path) => {
                    const result = await storage.info(path);
                    return !result.error && Boolean(result.data);
                },
                download: async (path) => {
                    const result = await storage.download(path);
                    return result.error ? null : result.data;
                },
            });
            if (result.status === 204) return new Response(null, {status: 204, headers});
            if (result.status === 403) return json(403, {error: 'access_denied'});
            if (result.status === 404) return json(404, {error: 'file_not_found'});
            if (result.status === 409) return json(409, {error: 'file_not_clean'});
            if (result.status !== 200) return json(503, {error: 'download_unavailable'});
            const audit = await service.from('audit_events').insert({
                actor_id: actor, action: 'job.source_downloaded', resource_id: jobId, details: {source_id: sourceId},
            });
            if (audit.error) return json(503, {error: 'download_unavailable'});
            return new Response(result.bytes, {headers: {
                ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': downloadDisposition(result.name),
                'Content-Security-Policy': "default-src 'none'; sandbox",
            }});
        }
        // Avatar selection is a narrow projection, not a general grant to personal files.
        if (data.action === 'avatar') {
            if (!uuid(data.user_id) || (data.version_id !== undefined && !uuid(data.version_id))) return json(400, {error: 'invalid_request'});
            const selected = await selectedAvatarBytes(data.user_id, {
                selection: async (target) => {
                    const result = await user.rpc('profile_avatar', {p_user_id: target});
                    if (result.error) throw new Error('access_denied');
                    return result.data;
                },
                version: async (id) => {
                    const result = await service.from('document_versions')
                        .select('id,document_id,object_path,status,mime_type,size_bytes').eq('id', id).maybeSingle();
                    return result.error ? null : result.data;
                },
                document: async (id) => {
                    const result = await service.from('documents')
                        .select('owner_id,scope,kind,deleted_at').eq('id', id).maybeSingle();
                    return result.error ? null : result.data;
                },
                download: async (path) => {
                    const result = await service.storage.from('portal-clean').download(path);
                    return result.error || !result.data ? null : new Uint8Array(await result.data.arrayBuffer());
                },
            }, data.version_id as string | undefined);
            return new Response(webFileBytes(selected.bytes), {
                headers: {
                    ...headers, 'Content-Type': 'image/png',
                    'X-Avatar-Version': selected.versionId,
                    'Content-Disposition': 'inline; filename="avatar.png"', 'Content-Security-Policy': "default-src 'none'; sandbox"
                }
            });
        }
        // Evidence grants bind the exact reviewed version and are checked again after Storage reads.
        if (data.action === 'qualification_evidence_download') {
            if (!uuid(data.evidence_id)) return json(400, {error: 'invalid_request'});
            const selected = await qualificationEvidenceBytes(data.evidence_id, {
                selection: async (id) => {
                    const r = await user.rpc('qualification_evidence_access', {p_evidence_id: id});
                    return r.error ? null : r.data;
                },
                version: async (id) => {
                    const r = await service.from('document_versions').select('id,document_id,object_path,status,mime_type,original_name,size_bytes,sha256').eq('id', id).maybeSingle();
                    return r.error ? null : r.data;
                },
                document: async (id) => {
                    const r = await service.from('documents').select('owner_id,scope,kind,deleted_at').eq('id', id).maybeSingle();
                    return r.error ? null : r.data;
                },
                download: async (path) => {
                    const r = await service.storage.from('portal-clean').download(path);
                    return r.error || !r.data ? null : new Uint8Array(await r.data.arrayBuffer());
                }
            });
            const audit = await service.from('audit_events').insert({actor_id: actor, action: 'qualification.evidence_downloaded', resource_id: data.evidence_id});
            if (audit.error) return json(503, {error: 'download_unavailable'});
            return new Response(webFileBytes(selected.bytes), {headers: {...headers, 'Content-Type': selected.mime_type, 'Content-Disposition': downloadDisposition(selected.original_name), 'Content-Security-Policy': "default-src 'none'; sandbox"}});
        }
        // This branch never extends generic file discovery or gives out a Storage URL.
        if (data.action === 'organisation_contract_download') {
            const company = data.organisation_id, id = data.id;
            if (!uuid(company) || !uuid(id) || Object.keys(data).length !== 3) return json(400, {error: 'invalid_request'});
            const selected = await organisationContractBytes(id.toLowerCase(), MAX_FILE_SIZE, {
                selection: async (documentId) => {
                    const r = await user.rpc('organisation_contract_download', {p_organisation_id: company, p_document_id: documentId});
                    return r.error ? null : r.data;
                },
                version: async (versionId) => {
                    const r = await service.from('document_versions')
                        .select('id,document_id,object_path,status,mime_type,size_bytes,sha256').eq('id', versionId).maybeSingle();
                    return r.error ? null : r.data;
                },
                download: async (path) => {
                    const r = await service.storage.from('portal-clean').download(path);
                    return r.error ? null : r.data;
                },
            });
            const audit = await service.from('audit_events').insert({actor_id: actor, action: 'organisation.contract_downloaded', resource_id: id});
            if (audit.error) return json(503, {error: 'download_unavailable'});
            return new Response(selected.bytes, {headers: {
                ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': downloadDisposition(selected.name),
                'Content-Security-Policy': "default-src 'none'; sandbox",
            }});
        }
        if (data.action === 'course_peer_feedback_download') {
            const run = data.run_id, round = data.round, id = data.version_id;
            if (!uuid(run) || !uuid(id) || typeof round !== 'number' || !Number.isInteger(round) ||
                round < 1 || round > 999999999 || Object.keys(data).length !== 4)
                return json(400, {error: 'invalid_request'});
            const authorize = () => user.rpc('course_peer_feedback_attachment', {
                p_run_id: run, p_round_number: round, p_version_id: id,
            }, {get: true});
            const before = await authorize();
            const grant = before.data;
            if (before.error || grant?.version_id !== id || !/^[a-f0-9]{64}$/.test(grant.sha256) ||
                !['application/pdf', 'text/plain'].includes(grant.mime_type) ||
                !Number.isSafeInteger(grant.size_bytes) || grant.size_bytes < 1 ||
                grant.size_bytes > academyMaterialMaxBytes) throw new Error('access_denied');
            const version = await service.from('document_versions').select('object_path').eq('id', id).maybeSingle();
            if (version.error || !version.data?.object_path) throw new Error('access_denied');
            const file = await service.storage.from('portal-clean').download(version.data.object_path);
            if (file.error || !file.data) throw new Error('access_denied');
            const bytes = await readExpectedBytes(file.data, grant.size_bytes);
            if (await sha256FileHex(bytes) !== grant.sha256) throw new Error('access_denied');
            const after = await authorize();
            if (after.error || after.data?.version_id !== id || after.data.sha256 !== grant.sha256)
                throw new Error('access_denied');
            const name = grant.mime_type === 'application/pdf' ? 'peer-attachment.pdf' : 'peer-attachment.txt';
            return new Response(webFileBytes(bytes), {headers: {...headers, 'Content-Type': grant.mime_type,
                'Content-Disposition': downloadDisposition(name), 'Content-Security-Policy': "default-src 'none'; sandbox"}});
        }
        if (data.action === 'course_scorm_download' || data.action === 'course_h5p_download') {
            const run = data.run_id, id = data.version_id;
            if (!uuid(run) || !uuid(id) || Object.keys(data).length !== 3) return json(400, {error: 'invalid_request'});
            const authorize = () => user.rpc(data.action === 'course_h5p_download' ? 'course_h5p_download' : 'course_scorm_download', {p_run_id: run, p_version_id: id});
            const before = await authorize();
            if (before.error || before.data?.version_id !== id || !/^[a-f0-9]{64}$/.test(before.data.sha256) ||
                !Number.isSafeInteger(before.data.size_bytes) || before.data.size_bytes < 4 ||
                before.data.size_bytes > academyMaterialMaxBytes) throw new Error('access_denied');
            const version = await service.from('document_versions').select('object_path').eq('id', id).maybeSingle();
            if (version.error || !version.data?.object_path) throw new Error('access_denied');
            const file = await service.storage.from('portal-clean').download(version.data.object_path);
            if (file.error || !file.data) throw new Error('access_denied');
            const bytes = await readExpectedBytes(file.data, before.data.size_bytes);
            if (await sha256FileHex(bytes) !== before.data.sha256) throw new Error('access_denied');
            const after = await authorize();
            if (after.error || after.data?.version_id !== id || after.data.sha256 !== before.data.sha256)
                throw new Error('access_denied');
            return new Response(webFileBytes(bytes), {headers: {...headers, 'Content-Type': 'application/zip',
                'Content-Disposition': downloadDisposition(before.data.name), 'Content-Security-Policy': "default-src 'none'; sandbox"}});
        }
        if (data.action !== 'download' || !uuid(data.id) || (data.version_id !== undefined && !uuid(data.version_id))) return json(400, {error: 'invalid_request'});
        const doc = await visible(data.id);
        // Bind the requested version to the currently visible document and require clean status.
        const version = await user.from('document_versions').select('id,object_path,status,original_name,mime_type').eq('id', data.version_id ?? doc.current_version_id).eq('document_id', doc.id).maybeSingle();
        if (version.error || !version.data || version.data.status !== 'clean') return json(409, {error: 'file_not_clean'});
        const file = await service.storage.from('portal-clean').download(version.data.object_path);
        if (file.error || !file.data) return json(404, {error: 'file_not_found'});
        const current = await visible(doc.id); // Recheck revocation immediately before returning any bytes.
        if (['personal', 'job_before', 'job_after'].includes(current.scope) &&
            ['material', 'invoice', 'participant_submission'].includes(current.kind)) {
            const receipt = await service.rpc('record_admin_file_download', {p_actor_id: actor, p_resource_id: doc.id});
            if (receipt.error) return json(503, {error: 'download_unavailable'});
        } else {
            const audit = await service.from('audit_events').insert({actor_id: actor, action: 'document.downloaded', resource_id: doc.id});
            if (audit.error) return json(503, {error: 'download_unavailable'});
        }
        return new Response(file.data, {headers: {...headers, 'Content-Type': version.data.mime_type, 'Content-Disposition': downloadDisposition(version.data.original_name), 'Content-Security-Policy': "default-src 'none'; sandbox"}});
        // Return only allowed stable error codes, not Storage paths, tokens or internal provider responses.
    } catch (error) {
        const code = error instanceof RequestBodyTooLarge ? 'file_size' : error instanceof Error ? error.message : '';
        return json(code === 'deletion_unavailable' ? 503 : code === 'access_denied' ? 403 : code === 'avatar_unavailable' ? 404 : code === 'avatar_changed' ? 409 : code === 'file_size' ? 413 : code === 'unsupported_type' ? 415 : 400, {error: ['deletion_unavailable', 'access_denied', 'avatar_unavailable', 'avatar_changed', 'file_size', 'unsupported_type', 'avatar_image_invalid'].includes(code) ? code : 'invalid_request'});
    }
});
