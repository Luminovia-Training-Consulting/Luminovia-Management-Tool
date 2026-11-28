/**
 * File-format cases use actual fixture bytes to test MIME/extension/size/name rules. Native gateway/Storage/scanning flows are exercised by API suites.
 */
import {downloadDisposition, safeName, validateFile} from './validation.ts';
import {scan} from './clamav.ts';
import {academyChatRoom, academyMaterialCourse, courseSubmissionRun} from './academy-material.ts';

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

Deno.test('dedicated chat multipart never accepts a course ID, duplicate room or generic transport', () => {
    const room = '52b7ddee-2166-485a-bcee-04d0eea958d1';
    const form = () => {
        const body = new FormData();
        body.set('academy_room_id', room);
        body.set('client_id', room);
        body.set('file', new File(['fictional room note'], 'note.txt'));
        return body;
    };
    assert(academyChatRoom(form(), true) === room);
    for (const [active, extra] of [[false, null], [true, 'room_id'], [true, 'academy_course_id'], [true, 'academy_room_id']] as const) {
        const body = form();
        if (extra) body.append(extra, room);
        let rejected = false;
        try {
            academyChatRoom(body, active);
        } catch (error) {
            rejected = error instanceof Error && error.message === 'invalid_request';
        }
        assert(rejected);
    }
});

Deno.test('private submission multipart requires the exact scoped transport and rejects generic inputs', () => {
    const id = '52b7ddee-2166-485a-bcee-04d0eea958d1';
    const form = () => {
        const body = new FormData();
        body.set('course_run_id', id);
        body.set('client_id', id);
        body.set('file', new File(['fictional submission'], 'lab.txt'));
        return body;
    };
    assert(courseSubmissionRun(form(), true) === id);
    assert(courseSubmissionRun(new FormData(), false) === null);
    for (const [active, extra] of [[false, null], [true, 'course_run_id'], [true, 'owner_id'], [true, 'academy_course_id']] as const) {
        const body = form();
        if (extra) body.append(extra, id);
        let rejected = false;
        try {
            courseSubmissionRun(body, active);
        } catch (error) {
            rejected = error instanceof Error && error.message === 'invalid_request';
        }
        assert(rejected);
    }
});

Deno.test('assignment intake requires precisely one additional assignment field', () => {
    const id = '52b7ddee-2166-485a-bcee-04d0eea958d1';
    const form = new FormData();
    form.set('course_run_id', id);
    form.set('client_id', id);
    form.set('file', new File(['fictional assignment'], 'lab.txt'));
    const rejectsIntake = (assignment: boolean) => {
        try {
            courseSubmissionRun(form, true, assignment);
            return false;
        } catch (error) {
            return error instanceof Error && error.message === 'invalid_request';
        }
    };
    assert(rejectsIntake(true));
    form.set('assignment_id', id);
    assert(courseSubmissionRun(form, true, true) === id);
    assert(rejectsIntake(false));
    form.append('assignment_id', id);
    assert(rejectsIntake(true));
});

Deno.test('normalizes names without paths, controls or unsafe download headers', () => {
    assert(safeName('../folder\\lesson\r\n.txt') === 'lesson.txt');
    const header = downloadDisposition('lesson\r\n".pdf');
    assert(!/[\r\n]/.test(header));
    assert(header.startsWith("attachment; filename*=UTF-8''"))
});
Deno.test('long Unicode filenames preserve their format and yield a valid download header', async () => {
    const long = 'a'.repeat(195) + '📚.txt';
    const name = safeName(long);
    assert(name.length <= 200 && name.isWellFormed());
    assert(name.endsWith('.txt'));
    assert(await validateFile(new TextEncoder().encode('Fictional lesson'), name, 'text/plain') === 'text/plain');
    assert(decodeURIComponent(downloadDisposition(long).split("''")[1]) === name);

    const short = 'Lernmaterial 📚.txt';
    assert(decodeURIComponent(downloadDisposition(short).split("''")[1]) === short);
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
Deno.test('UTF-8 validation preserves split characters and fails on incomplete final input', async () => {
    const prefix = 'a'.repeat(64 * 1024 - 1);
    const bytes = new TextEncoder().encode(prefix + '📚');
    assert(await validateFile(bytes, 'lesson.txt', 'text/plain') === 'text/plain');
    for (const invalid of [bytes.subarray(0, bytes.length - 1), new TextEncoder().encode(prefix + '📚\u0000')]) {
        let rejected = false;
        try {
            await validateFile(invalid, 'lesson.txt', 'text/plain');
        } catch {
            rejected = true;
        }
        assert(rejected);
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
