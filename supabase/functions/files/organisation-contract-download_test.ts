import {assertEquals, assertRejects} from 'jsr:@std/assert@1.0.15';
import {sha256FileHex} from '../_shared/file-bytes.ts';
import {organisationContractBytes} from './organisation-contract-download.ts';

async function fixture() {
    const object = new Blob(['%PDF-1.4 fictional agreement'], {type: 'application/pdf'});
    const sha256 = await sha256FileHex(await object.arrayBuffer());
    const expected = {document_id: 'agreement', version_id: 'scanned', file_name: 'Agreement.pdf', sha256};
    const calls: string[] = [];
    const version = {document_id: expected.document_id, id: expected.version_id, object_path: 'internal-path',
        status: 'clean', mime_type: 'application/pdf', size_bytes: object.size, sha256};
    return {expected, object, version, calls, deps: {
        selection: (_id: string): Promise<typeof expected | null> => {
            calls.push('selection');
            return Promise.resolve(expected);
        },
        version: (_id: string) => {
            calls.push('version');
            return Promise.resolve(version);
        },
        download: (_path: string): Promise<ReadableStream<Uint8Array>> => {
            calls.push('download');
            return Promise.resolve(object.stream());
        },
    }};
}

Deno.test('company download verifies bytes and rechecks the selected exact version', async () => {
    const {object, deps, calls} = await fixture();
    const selected = await organisationContractBytes('agreement', 1024, deps);
    assertEquals(selected.name, 'Agreement.pdf');
    assertEquals(new Uint8Array(selected.bytes), new Uint8Array(await object.arrayBuffer()));
    assertEquals(calls, ['selection', 'version', 'download', 'selection']);
});

Deno.test('inaccessible or unscanned company files do not read the object', async () => {
    const {deps, calls, version} = await fixture();
    await assertRejects(() => organisationContractBytes('other-document', 1024, deps), Error, 'access_denied');
    assertEquals(calls, ['selection']);
    calls.length = 0;
    version.status = 'scanning';
    await assertRejects(() => organisationContractBytes('agreement', 1024, deps), Error, 'access_denied');
    assertEquals(calls, ['selection', 'version']);
});

Deno.test('company downloads fail closed on content mismatch or changed access', async () => {
    const {deps, expected, object} = await fixture();
    const download = deps.download;
    deps.download = () => Promise.resolve(new Blob([new Uint8Array(object.size)]).stream());
    await assertRejects(() => organisationContractBytes('agreement', 1024, deps), Error, 'access_denied');
    deps.download = download;
    let checks = 0;
    deps.selection = () => Promise.resolve(++checks === 1 ? expected : null);
    await assertRejects(() => organisationContractBytes('agreement', 1024, deps), Error, 'access_denied');
    assertEquals(checks, 2);
});

Deno.test('company download rejects a short Storage stream and aborts an overlong stream', async () => {
    const short = await fixture();
    short.version.size_bytes += 1;
    await assertRejects(() => organisationContractBytes('agreement', 1024, short.deps), Error, 'access_denied');
    assertEquals(short.calls, ['selection', 'version', 'download']);

    const overlong = await fixture();
    overlong.version.size_bytes -= 1;
    let cancelled = false;
    let sent = false;
    overlong.deps.download = (_path) => {
        overlong.calls.push('download');
        return Promise.resolve(new ReadableStream<Uint8Array>({
            pull(controller) {
                if (sent) return;
                sent = true;
                controller.enqueue(new Uint8Array(overlong.version.size_bytes + 1));
            },
            cancel() {
                cancelled = true;
            },
        }));
    };
    await assertRejects(() => organisationContractBytes('agreement', 1024, overlong.deps), Error, 'access_denied');
    assertEquals(cancelled, true);
    assertEquals(overlong.calls, ['selection', 'version', 'download']);
});

Deno.test('company download does not release bytes if Storage fails before completion', async () => {
    const result = await fixture();
    result.deps.download = () => Promise.resolve(new ReadableStream<Uint8Array>({
        pull(controller) {
            controller.error(new Error('upstream connection closed'));
        },
    }));
    await assertRejects(
        () => organisationContractBytes('agreement', 1024, result.deps),
        Error,
        'access_denied',
    );
    assertEquals(result.calls, ['selection', 'version']);
});
