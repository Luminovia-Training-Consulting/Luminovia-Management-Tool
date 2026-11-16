import { fontkit, PDFDocument, rgb } from "./vendor/pdf-runtime.js";
type Facts = Record<string, unknown>;
const titles: Record<string, string> = {
  completion: "Teilnahmebestätigung / Completion record",
  attendance: "Anwesenheitsbericht / Attendance report",
  earnings_statement: "Honorarübersicht / Earnings statement",
  assignment_confirmation: "Auftragsbestätigung / Assignment confirmation",
};
function printable(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "Ja / Yes" : "Nein / No";
  return String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .normalize("NFC");
}
export function factLines(kind: string, facts: Facts): string[] {
  if (kind === "completion") {
    return [
      `Teilnehmende Person / Participant: ${printable(facts.participant)}`,
      `Kurs / Course: ${printable(facts.course)}`,
      `Zeitraum / Period: ${printable(facts.starts_at)} - ${
        printable(facts.ends_at)
      }`,
      `Zeitzone / Time zone: ${printable(facts.time_zone)}`,
      `Geprüfte Anwesenheit / Verified attendance: ${
        printable(facts.verified_minutes)
      } Minuten / minutes`,
      `Quiznachweis / Quiz evidence: ${
        facts.quiz_passed
          ? "Bestanden / Passed"
          : facts.quiz_version === null || facts.quiz_version === undefined
          ? "Nicht vorgesehen / Not required"
          : "Nicht bestanden / Not passed"
      }`,
      `Ausgestellt / Issued: ${printable(facts.issued_at)}`,
      `Nachweis-ID / Record ID: ${printable(facts.id)}`,
      "Dieses Dokument bestätigt ausschließlich die gespeicherten Teilnahmefakten.",
      "This document records the stored participation facts only.",
      "Keine qualifizierte Signatur oder externe Zertifizierung. / No qualified signature or external certification.",
    ];
  }
  if (kind === "attendance") {
    const sessions = Array.isArray(facts.sessions)
      ? facts.sessions as Facts[]
      : [];
    const lines = [
      `Kurs / Course: ${printable(facts.course)}`,
      `Kurs-ID / Course ID: ${printable(facts.id)}`,
    ];
    for (
      const person
        of (Array.isArray(facts.roster) ? facts.roster : []) as Facts[]
    ) {
      lines.push(
        "",
        `Teilnehmende Person / Participant: ${printable(person.name)}`,
      );
      for (
        const attendance
          of (Array.isArray(person.sessions) ? person.sessions : []) as Facts[]
      ) {
        const session = sessions.find((item) =>
          item.id === attendance.session_id
        );
        lines.push(
          `${printable(session?.starts_at)} | ${
            printable(attendance.state)
          } | ${printable(attendance.minutes)} min`,
        );
      }
    }
    lines.push(
      "",
      "Selbstmeldungen sind keine bestätigte Anwesenheit. / Self-reports are not verified attendance.",
    );
    return lines;
  }
  // Render the reviewed financial projection field by field. Its hash binds
  // original accepted currency/terms; arbitrary nested objects are not printed.
  const data = facts.data as Facts | undefined;
  if (data && typeof data === "object" && typeof facts.hash === "string") {
    const assignment = (item: Facts) => [
      `Kurs / Course: ${printable(item.title)}`,
      `Auftraggeber / Customer: ${printable(item.customer_name)}`,
      `Dozierende Person / Lecturer: ${printable(item.lecturer_name)}`,
      `Übernommen / Accepted: ${printable(item.accepted_at)} | ${
        printable(item.status)
      }`,
      `Honorar / Accepted rate: ${printable(item.amount)} ${
        printable(item.currency)
      } | ${printable(item.rate_unit)}`,
      `Gesamthonorar / Accepted total: ${printable(item.total_amount)} ${
        printable(item.currency)
      }`,
      ...(item.terms_version === undefined ? [] : [
        `Konditionenfassung / Terms version: ${printable(item.terms_version)}`,
      ]),
      ...((Array.isArray(item.sessions)
        ? item.sessions
        : item.starts_at
        ? [{ starts_at: item.starts_at, ends_at: item.ends_at }]
        : []) as Facts[]).map(
          (session) =>
            `${printable(session.starts_at)} - ${
              printable(session.ends_at)
            } | ${printable(item.time_zone ?? data.time_zone)}${
              session.released_at ? " | freigegeben / released" : ""
            }`,
        ),
    ];
    const lines = kind === "assignment_confirmation"
      ? [...assignment(data), "", printable(data.terms)]
      : [
        `Konto / Account: ${printable(data.account_name)}`,
        `Zeitraum / Period: ${printable(data.from)} - ${
          printable(data.until)
        } (Ende exklusiv / end exclusive)`,
        `Umfang / Scope: ${printable(data.scope)}`,
        ...((Array.isArray(data.claims) ? data.claims : []) as Facts[]).flatMap(
          (item) => [
            "",
            ...assignment(item),
            `Rechnungsstatus / Invoice state: ${
              printable(item.invoice_status ?? item.stage)
            }`,
          ],
        ),
        "",
        ...((Array.isArray(data.totals) ? data.totals : []) as Facts[]).map(
          (item) =>
            `Währung / Currency: ${
              printable(item.currency)
            } | erwartet / expected: ${
              printable(item.expected)
            } | abgeschlossen / completed: ${
              printable(item.completed)
            } | abgerechnet / invoiced: ${
              printable(item.invoiced)
            } | bezahlt / paid: ${printable(item.paid)}`,
        ),
        ...((Array.isArray(data.approved_minutes)
          ? data.approved_minutes
          : []) as Facts[]).map((item) =>
            `Auftrag / Assignment ${
              printable(item.claim_id)
            } | geprüfte Minuten / approved minutes: ${printable(item.minutes)}`
          ),
      ];
    return [
      ...lines,
      "",
      `Nachweis-Hash / Record hash: ${facts.hash}`,
      "Keine Steuerberechnung, Zahlung oder qualifizierte Signatur. / No tax calculation, payment or qualified signature.",
    ];
  }
  throw new Error("invalid_document_facts");
}
export async function renderFactPdf(
  kind: string,
  facts: Facts,
  fontBytes: Uint8Array,
): Promise<Uint8Array> {
  const title = titles[kind];
  if (!title) throw new Error("invalid_document_kind");
  const lines = factLines(kind, facts);
  if (lines.length > 10000 || lines.some((line) => line.length > 20000)) {
    throw new Error("document_too_large");
  }
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = await document.embedFont(fontBytes, { subset: true });
  const supported = new Set(font.getCharacterSet());
  for (const text of [title, ...lines]) {
    for (const char of text) {
      if (
        char !== "\n" && char !== "\r" && char !== "\t" &&
        !supported.has(char.codePointAt(0)!)
      ) throw new Error("unsupported_glyph");
    }
  }
  const issued = typeof facts.issued_at === "string"
    ? new Date(facts.issued_at)
    : new Date("2000-01-01T00:00:00Z");
  if (!Number.isFinite(issued.getTime())) {
    throw new Error("invalid_document_facts");
  }
  document.setCreationDate(issued);
  document.setModificationDate(issued);
  document.setAuthor("Luminovia Training & Consulting");
  document.setCreator("Luminovia Portal");
  document.setProducer("Luminovia Portal");
  document.setTitle(title);
  const navy = rgb(0.075, 0.12, 0.24),
    blue = rgb(0.09, 0.28, 0.71),
    cream = rgb(0.985, 0.977, 0.95);
  let page = document.addPage([595.28, 841.89]);
  let y = 740;
  let pageNumber = 0;
  function header() {
    pageNumber++;
    page.drawRectangle({ x: 0, y: 785, width: 596, height: 57, color: navy });
    page.drawText("LUMINOVIA", {
      x: 44,
      y: 806,
      size: 20,
      font,
      color: rgb(1, 1, 1),
    });
    page.drawRectangle({ x: 0, y: 780, width: 596, height: 5, color: blue });
    page.drawRectangle({ x: 32, y: 32, width: 531, height: 38, color: cream });
    page.drawText(`Luminovia Portal  |  ${pageNumber}`, {
      x: 44,
      y: 47,
      size: 8,
      font,
      color: navy,
    });
    y = 750;
  }
  function line(text: string, size = 10) {
    if (y < 92) {
      page = document.addPage([595.28, 841.89]);
      header();
    }
    page.drawText(text, { x: 44, y, size, font, color: navy });
    y -= size + 7;
  }
  function wrap(text: string, size: number) {
    let current = "";
    for (const character of text.replace(/[\r\t]/g, " ")) {
      if (character === "\n") {
        line(current, size);
        current = "";
        continue;
      }
      if (font.widthOfTextAtSize(current + character, size) > 506 && current) {
        const boundary = current.lastIndexOf(" ");
        if (boundary > 0) {
          line(current.slice(0, boundary), size);
          current = current.slice(boundary + 1);
        } else {
          line(current, size);
          current = "";
        }
      }
      current += character;
    }
    line(current, size);
  }
  header();
  wrap(title, 16);
  y -= 15;
  for (const text of lines) wrap(printable(text), 10);
  return await document.save({ useObjectStreams: true });
}
