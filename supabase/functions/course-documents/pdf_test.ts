import {factLines, renderFactPdf} from "./pdf.ts";
import {PDFDocument} from "./vendor/pdf-runtime.js";

const font = await Deno.readFile(
    new URL("./assets/DejaVuSans.ttf", import.meta.url),
);
const facts = {
    id: "52b7ddee-2166-485a-bcee-04d0eea958d1",
    participant: "Carina Müller · Μαρία · Мария",
    course: "Linux: Übung & sichere Rechte",
    time_zone: "Europe/Berlin",
    starts_at: "2026-11-01T08:00:00Z",
    ends_at: "2026-11-01T15:00:00Z",
    verified_minutes: 420,
    quiz_passed: true,
    issued_at: "2026-11-02T09:00:00Z",
};

function assert(value: unknown, message = "Assertion failed"): asserts value {
    if (!value) throw new Error(message);
}

Deno.test("real Unicode completion PDF embeds German, Greek and Cyrillic and is deterministic", async () => {
    const first = await renderFactPdf("completion", facts, font);
    const second = await renderFactPdf("completion", facts, font);
    assert(first.length > 10000);
    assert(
        first.length === second.length &&
        first.every((byte, i) => byte === second[i]),
    );
    const doc = await PDFDocument.load(first);
    assert(doc.getPageCount() === 1);
    assert(doc.getTitle()?.includes("Completion record"));
});
Deno.test("real font renderer explicitly rejects unsupported characters", async () => {
    let rejected = false;
    try {
        await renderFactPdf("completion", {...facts, participant: "漢字"}, font);
    } catch (error) {
        rejected = error instanceof Error && error.message === "unsupported_glyph";
    }
    assert(rejected);
});
Deno.test("long attendance reports paginate without clipping or loss of rows", async () => {
    const roster = Array.from(
        {length: 120},
        (_, i) => ({
            name: `Fictional attendee ${i}`,
            sessions: [{session_id: "session-a", state: "attended", minutes: 60}],
        }),
    );
    const bytes = await renderFactPdf("attendance", {
        id: facts.id,
        course: facts.course,
        roster,
        sessions: [{id: "session-a", starts_at: facts.starts_at}],
    }, font);
    const doc = await PDFDocument.load(bytes);
    assert(doc.getPageCount() >= 5);
});
Deno.test("an exact session PDF formats actual local time offsets and distinguishes register statuses", async () => {
    const session = {id: facts.id, starts_at: "2027-10-31T00:15:00Z", ends_at: "2027-10-31T02:00:00Z"};
    const documentFacts = {
        report_scope: "session", course: "Fictional workshop", id: facts.id, time_zone: "Europe/Berlin",
        sessions: [session], roster: [
            {name: "Fiktionale Teilnehmende Ä", sessions: [{session_id: session.id, status: "present", minutes: 60,
                arrival_at: "2027-10-31T00:30:00Z", departure_at: "2027-10-31T01:30:00Z"}]},
            {name: "Fictional second learner", sessions: [{session_id: session.id, status: "excused", minutes: 0}]},
            {name: "Fictional third learner", sessions: [{session_id: session.id, status: null, minutes: null}]},
        ],
    };
    const lines = factLines("attendance", documentFacts).join("\n");
    assert(/Ankunft \/ Arrival: .*02:30.*\+02:00/.test(lines));
    assert(/Ende \/ Departure: .*02:30.*\+01:00/.test(lines));
    assert(lines.includes("Entschuldigt / Excused"));
    assert(lines.includes("Nicht erfasst / Not marked"));
    const pdf = await PDFDocument.load(await renderFactPdf("attendance", documentFacts, font));
    assert(pdf.getPageCount() === 1);
    assert(pdf.getTitle()?.includes("Attendance report"));
});

Deno.test("dedicated PDF metadata uses the issued academy brand and leaves the internal defaults intact", async () => {
    const internal = await PDFDocument.load(await renderFactPdf("completion", facts, font));
    assert(internal.getAuthor() === "Luminovia Training & Consulting");
    assert(internal.getCreator() === "Luminovia Portal");
    const academy = "Fiktive Fachakademie Ä · Μαρία";
    const issued = {
        ...facts,
        academy_pdf_brand: {name: academy, short_name: "Fachakademie", theme_color: "#2b8574"},
    };
    const bytes = await renderFactPdf("completion", issued, font);
    const document = await PDFDocument.load(bytes, {updateMetadata: false});
    assert(document.getAuthor() === academy);
    assert(document.getCreator() === academy);
    assert(document.getProducer() === academy);
    assert(document.getCreationDate()?.toISOString() === facts.issued_at.replace("Z", ".000Z"));
    assert(document.getTitle()?.includes("Completion record"));
    const repeat = await renderFactPdf("completion", issued, font);
    assert(repeat.length === bytes.length && repeat.every((byte, index) => byte === bytes[index]));
});

Deno.test("a course attendance report indexes sessions once and keeps roster order and missing dates", () => {
    let idReads = 0;
    const sessions = Array.from({length: 250}, (_, i) => ({
        get id() {
            idReads++;
            return `session-${i}`;
        },
        starts_at: new Date(Date.UTC(2026, 0, 1 + i, 9)).toISOString(),
    }));
    const entries = [
        {session_id: "session-249", state: "attended", minutes: 60},
        {session_id: "session-1", state: "excused", minutes: 0},
        {session_id: "missing", state: "unverified", minutes: 0},
    ];
    const roster = Array.from({length: 50}, (_, i) => ({
        name: `Fictional attendee ${i}`,
        sessions: entries,
    }));
    const lines = factLines("attendance", {id: facts.id, course: facts.course, sessions, roster});
    const section = lines.indexOf("Teilnehmende Person / Participant: Fictional attendee 49");
    assert(section >= 0);
    assert(lines[section + 1] === `${sessions[249].starts_at} | attended | 60 min`);
    assert(lines[section + 2] === `${sessions[1].starts_at} | excused | 0 min`);
    assert(lines[section + 3] === "- | unverified | 0 min");
    assert(idReads === sessions.length, `Expected one lookup per session, got ${idReads}`);
});
