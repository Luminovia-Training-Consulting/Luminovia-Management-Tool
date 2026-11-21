/**
 * File-format cases use actual fixture bytes to test MIME/extension/size/name rules. Native gateway/Storage/scanning flows are exercised by API suites.
 */
import {downloadDisposition, safeName, validateFile} from './validation.ts';
import {scan} from './clamav.ts';
import {academyMaterialCourse} from './academy-material.ts';

// Fail a specific fixture condition as a real test failure; never substitute silent success.
function assert(value: unknown, message = 'assertion failed'): asserts value {
    if (!value) throw new Error(message)
}

Deno.test('dedicated course multipart selector rejects duplicates and all other upload modes', () => {
    const id = '52b7ddee-2166-485a-bcee-04d0eea958d1';
    const build = () => {
        const form = new FormData();
        form.set('academy_course_id', id);
        form.set('client_id', id);
        form.set('file', new File(['fictional handout'], 'handout.txt'));
        return form;
    };
    assert(academyMaterialCourse(build(), true) === id);
    const internal = new FormData();
    internal.set('scope', 'personal');
    assert(academyMaterialCourse(internal, false) === null);
    for (const [mode, extra] of [[false, null], [true, 'scope'], [true, 'owner_id'], [true, 'academy_course_id'], [true, 'file']] as const) {
        const form = build();
        if (extra) form.append(extra, 'invalid');
        let rejected = false;
        try {
            academyMaterialCourse(form, mode);
        } catch (error) {
            rejected = error instanceof Error && error.message === 'invalid_request';
        }
        assert(rejected);
    }
});

Deno.test('normalizes names without paths, controls or unsafe download headers', () => {
    assert(safeName('../folder\\lesson\r\n.txt') === 'lesson.txt');
    const header = downloadDisposition('lesson\r\n".pdf');
    assert(!/[\r\n]/.test(header));
    assert(header.startsWith("attachment; filename*=UTF-8''"))
});
Deno.test('valid text works but forged extension, HTML and MIME disagreement are rejected', async () => {
    assert(await validateFile(new TextEncoder().encode('Fictional lesson'), 'lesson.txt', 'text/plain') === 'text/plain');
    for (const [name, mime] of [['lesson.pdf', 'application/pdf'], ['lesson.html', 'text/html'], ['lesson.txt', 'application/pdf']]) {
        let rejected = false;
        try {
            await validateFile(new TextEncoder().encode('Fictional lesson'), name, mime)
        } catch {
            rejected = true
        }
        assert(rejected, name)
    }
});
Deno.test('empty/oversized/invalid binary text never passes content validation', async () => {
    for (const bytes of [new Uint8Array(), new Uint8Array(104857601), new Uint8Array([0, 1, 2, 3])]) {
        let rejected = false;
        try {
            await validateFile(bytes, 'data.txt', 'text/plain')
        } catch {
            rejected = true
        }
        assert(rejected)
    }
});
Deno.test('missing scanner fails closed before network or clean verdict', async () => {
    let rejected = false;
    try {
        await scan(new Uint8Array([1]), '')
    } catch {
        rejected = true
    }
    assert(rejected)
});
