/** Render only the reviewed own-passport projection. Labels are localized;
 * authored statements and filenames keep their original language. */
type Facts = Record<string, unknown>;

/** Keep provenance, current evidence availability and qualification state separate. */
export function passportLines(facts: Facts): string[] {
    const data = facts.data as Facts | undefined;
    if (
        !data || data.type !== "qualification_passport" ||
        !["de", "en"].includes(String(data.locale)) ||
        !/^[a-f0-9]{64}$/.test(String(facts.hash))
    ) throw new Error("invalid_document_facts");
    const de = data.locale === "de";
    const text = (value: unknown) =>
        value === null || value === undefined || value === "" ? "-" : String(value);
    const label = (german: string, english: string) => de ? german : english;
    const states: Record<string, string> = de
        ? {verified: "Geprüft", unverified: "Ungeprüft", expired: "Abgelaufen"}
        : {verified: "Verified", unverified: "Unverified", expired: "Expired"};
    const evidenceStates: Record<string, string> = de
        ? {
            available: "Verfügbar",
            none: "Keine aktuelle Bindung",
            withdrawn: "Zurückgezogen",
            unavailable: "Nicht verfügbar",
        }
        : {
            available: "Available",
            none: "No current binding",
            withdrawn: "Withdrawn",
            unavailable: "Unavailable",
        };
    const own = (data.self_declared ?? {}) as Facts;
    const qualifications = Array.isArray(data.qualifications)
        ? data.qualifications as Facts[]
        : [];
    const lines = [
        `${label("Person", "Person")}: ${text(data.display_name)}`,
        `${label("Erstellt", "Generated")}: ${text(data.issued_at)}`,
        `${label("Zeitzone des Profils", "Profile time zone")}: ${
            text(data.time_zone)
        }`,
        "",
        label("Selbstauskunft - nicht geprüft", "Self-declarations - unverified"),
        `${label("Land", "Country")}: ${text(own.country)}`,
        `${label("Sprachen", "Languages")}: ${
            Array.isArray(own.languages) && own.languages.length
                ? own.languages.join(", ")
                : "-"
        }`,
        `${
            label(
                "Lehrerfahrung (eigene Angabe)",
                "Teaching experience (own statement)",
            )
        }: ${text(own.teaching_experience)}`,
        "",
        label("Ausgewählte Fachgebiete", "Selected expertise"),
    ];
    if (!qualifications.length) {
        lines.push(
            label("Keine Fachgebiete ausgewählt.", "No expertise selected."),
        );
    }
    for (const entry of qualifications) {
        const attestation = entry.attestation as Facts | null;
        const evidence = entry.current_evidence as Facts | null;
        lines.push(
            "",
            text(de ? entry.label_de : entry.label_en),
            `${label("Status", "State")}: ${states[String(entry.status)] ?? "-"}${
                entry.archived
                    ? label(" | Katalogeintrag archiviert", " | Catalogue entry archived")
                    : ""
            }`,
            `${label("Gültig bis", "Valid until")}: ${text(entry.valid_until)}`,
            `${label("Datensatzversion", "Record version")}: ${
                text(entry.record_version)
            }`,
            `${label("Aktueller Nachweis", "Current evidence")}: ${
                evidenceStates[String(entry.current_evidence_status)] ?? "-"
            }`,
        );
        if (evidence) {
            lines.push(
                `${label("Datei und Version", "File and version")}: ${
                    text(evidence.name)
                } | ${text(evidence.version)}`,
                `SHA-256: ${text(evidence.sha256)}`,
                `${label("Gebunden am", "Bound at")}: ${text(evidence.bound_at)}`,
            );
        }
        if (attestation) {
            const basis = attestation.basis === "document_evidence"
                ? label(
                    "Dokumentierte Zertifikatsversion",
                    "Recorded certificate version",
                )
                : attestation.basis === "management_attestation"
                    ? label("Organisatorische Prüfentscheidung", "Management attestation")
                    : label("Nicht dokumentiert", "Not recorded");
            lines.push(
                `${label("Letzte Prüfentscheidung", "Last attestation")}: ${
                    text(attestation.at)
                } | ${
                    attestation.verified
                        ? label("Bestätigt", "Confirmed")
                        : label("Nicht bestätigt", "Not confirmed")
                }`,
                `${
                    label("Historische Prüfgrundlage", "Historical attestation basis")
                }: ${basis}`,
            );
            if (attestation.evidence_sha256) {
                lines.push(
                    `${
                        label("Historischer Nachweis-Hash", "Historical evidence hash")
                    }: ${text(attestation.evidence_sha256)}`,
                    `${
                        label("Nachweisbindung zurückgezogen", "Evidence binding withdrawn")
                    }: ${
                        attestation.evidence_withdrawn
                            ? label("Ja", "Yes")
                            : label("Nein", "No")
                    }`,
                );
            }
        } else {
            lines.push(
                label(
                    "Kein Prüfzeitpunkt und keine Prüfgrundlage dokumentiert; bestehender Status wird unverändert wiedergegeben.",
                    "No attestation date or basis is recorded; the existing state is reproduced unchanged.",
                ),
            );
        }
    }
    lines.push(
        "",
        `${label("Daten-Hash", "Facts hash")} (SHA-256): ${facts.hash}`,
        label(
            "Der Hash bindet diese gespeicherten Angaben; er ist keine digitale Signatur oder externe Zertifizierung.",
            "The hash binds these stored facts; it is not a digital signature or external certification.",
        ),
        label(
            "Nachweisbindung und Prüfstatus sind getrennte Angaben. Der Export enthält keine Zertifikatsdateien und ändert keine Prüfentscheidung.",
            "Evidence bindings and verification states are separate facts. This export contains no certificate files and changes no attestation.",
        ),
    );
    return lines;
}