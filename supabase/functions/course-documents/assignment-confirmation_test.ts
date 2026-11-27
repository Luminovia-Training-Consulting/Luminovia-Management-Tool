/** Check the exact supported facts and localized text before PDF font rendering. */
import assert from "node:assert/strict";
import { factLines } from "./pdf.ts";

Deno.test("assignment confirmations localize scope and omit unprojected finance fields", () => {
    const data = {
        claim_id: "019a1500-5678-4000-8000-123456789012",
        title: "Fictional workshop",
        customer_name: "Fictional customer",
        lecturer_name: "Fictional lecturer",
        confirmed_at: "2026-11-20T00:00:00Z",
        assignment_version: 2,
        terms_version: 3,
        contract_version: 4,
        status: "confirmed",
        delivery_type: "hybrid",
        physical_location: "Fictional Classroom",
        time_zone: "Australia/Brisbane",
        instructions: "Fictional arrival instructions",
        terms: "Fictional terms",
        planned_minutes: 270,
        paid_teaching_minutes: 225,
        teaching_unit_minutes: 45,
        amount: "400.00",
        total_amount: "450.00",
        currency: "AUD",
        additional_compensation: [{label: "Fictional travel", amount: "50.00"}],
        sessions: [{starts_at: "2026-11-22T00:00:00Z", ends_at: "2026-11-22T04:30:00Z"}],
        agreed_customer: "9001.00",
        contract_margin: "9002.00",
    };
    const facts = {data, hash: "f".repeat(64)};
    const german = factLines("assignment_confirmation", {...facts, locale: "de"}).join("\n");
    const english = factLines("assignment_confirmation", {...facts, locale: "en"}).join("\n");
    assert(german.includes("Auftragsreferenz: " + data.claim_id));
    assert(german.includes("Auftragsfassung: 2"));
    assert(german.includes("Unterrichtseinheiten: 5 (45 min)"));
    assert(english.includes("Teaching location: Fictional Classroom"));
    assert(english.includes("Additional compensation: Fictional travel · 50.00 AUD"));
    assert(english.includes("Scheduled hours: 4.5"));
    assert(!/900[12]\.00/.test(german + english));
    assert(factLines("assignment_confirmation", facts).some((line) => line.startsWith("Auftragsreferenz / Assignment reference:")));
});
