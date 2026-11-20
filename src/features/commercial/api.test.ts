/**
 * Regressions for formula-safe CSV cells and cent-based totals separated by original currency.
 * Pure export/aggregation tests do not establish commercial API authorization.
 */
import {describe, expect, it} from "vitest";
import {csvCell, csvText, groupedEarnings, invoiceDueState, invoicesDueFirst, monthlyEarningsTrend, monthlyInvoiceTrend,} from "./api";
import type {EarningRecord, InvoiceRecord} from "./types";

/** Create a small fictional fee row for currency/status aggregation cases. */
function row(
    currency: "EUR" | "AUD",
    total_amount: number,
    stage: EarningRecord["stage"],
): EarningRecord {
    return {
        claim_id: crypto.randomUUID(),
        job_id: "job",
        lecturer_id: "lecturer",
        lecturer_name: "QA",
        title: "Fictional",
        customer_name: "QA",
        starts_at: "2030-01-01T10:00:00Z",
        ends_at: "2030-01-01T11:00:00Z",
        amount: total_amount,
        rate_unit: "flat",
        total_amount,
        currency,
        stage,
        invoice_id: null,
        invoice_eligible_at: null,
        invoice_review_required: stage === "review",
        invoice_review_reason: stage === "review" ? "partial_delivery" : null,
        invoice_review_status: null,
        invoice_review_note: null,
    };
}

/** Create a fictional invoice for calendar-bound due-state assertions. */
function invoice(id: string, changes: Partial<InvoiceRecord> = {}): InvoiceRecord {
    return {
        id,
        labels: [],
        user_id: "lecturer",
        user_name: "Fictional lecturer",
        number: id,
        issued_on: "2026-11-01",
        due_on: "2026-12-01",
        currency: "EUR",
        total_amount: 100,
        paid_amount: 0,
        status: "approved",
        document_id: `document-${id}`,
        document_version_id: `version-${id}`,
        claim_ids: [`claim-${id}`],
        created_at: "2026-11-01T12:00:00Z",
        note: null,
        paid_at: null,
        ...changes,
    };
}

describe("scoped commercial exports and totals", () => {
    it("neutralizes formulas including leading whitespace and control characters", () => {
        for (const value of [
            "=1+1",
            "+SUM(A1)",
            "-2+3",
            "@SUM(A1)",
            '  =HYPERLINK("https://example.invalid")',
            "\t=1",
            "\r+1",
        ])
            expect(csvCell(value)).toMatch(/^"'/);
        expect(csvCell("=x\r\ny\tz")).toBe('"\'=x  y z"');
    });
    it("quotes commas and quotes without changing ordinary authored content", () => {
        expect(csvCell('Kurs, "Python"')).toBe('"Kurs, ""Python"""');
        expect(
            csvText([
                ["Währung", "Betrag"],
                ["EUR", 12.5],
            ]),
        ).toBe('\uFEFF"Währung","Betrag"\r\n"EUR","12.5"');
    });
    it("keeps original currencies and stages separate with cent arithmetic", () => {
        expect(
            groupedEarnings([
                row("EUR", 0.1, "expected"),
                row("AUD", 900, "expected"),
                row("EUR", 0.2, "expected"),
                row("EUR", 5, "review"),
                row("EUR", 12.34, "paid"),
                row("AUD", 20, "invoiced"),
            ]),
        ).toEqual([
            {
                currency: "EUR",
                expected: 0.3,
                review: 5,
                completed: 0,
                invoiced: 0,
                paid: 12.34,
            },
            {
                currency: "AUD",
                expected: 900,
                review: 0,
                completed: 0,
                invoiced: 20,
                paid: 0,
            },
        ]);
    });
    it("classifies due boundaries, partial balances, reversals and inactive invoices", () => {
        const open = invoice("open");
        expect(invoiceDueState(open, "2026-11-10")).toBe("early");
        expect(invoiceDueState(open, "2026-11-16")).toBe("half_term");
        expect(invoiceDueState(open, "2026-11-24")).toBe("due_soon");
        expect(invoiceDueState(open, "2026-12-01")).toBe("due_soon");
        expect(invoiceDueState(open, "2026-12-02")).toBe("overdue");
        expect(
            invoiceDueState(
                invoice("partial", {paid_amount: 25}),
                "2026-12-02",
            ),
        ).toBe("overdue");
        expect(
            invoiceDueState(
                invoice("reversed", {status: "approved", paid_amount: 0}),
                "2026-12-02",
            ),
        ).toBe("overdue");
        expect(invoiceDueState(invoice("paid", {status: "paid", paid_amount: 100}), "2026-12-02")).toBe("paid");
        expect(invoiceDueState(invoice("rejected", {status: "rejected"}), "2026-12-02")).toBe("inactive");
        expect(invoiceDueState(invoice("cancelled", {status: "cancelled"}), "2026-12-02")).toBe("inactive");
    });
    it("prioritizes overdue and due-soon invoices without combining currencies", () => {
        const rows = [
            invoice("inactive", {status: "cancelled"}),
            invoice("overdue", {due_on: "2026-11-20"}),
            invoice("late", {due_on: "2026-11-30"}),
            invoice("soon", {due_on: "2026-11-25"}),
            invoice("early", {due_on: "2026-12-30", currency: "AUD"}),
            invoice("paid", {status: "paid", paid_amount: 100}),
        ];
        expect(invoicesDueFirst(rows, "2026-11-24").map((item) => item.id)).toEqual([
            "overdue",
            "soon",
            "late",
            "early",
            "paid",
            "inactive",
        ]);
    });
    it("groups monthly trends by IANA display month and original currency", () => {
        expect(
            monthlyEarningsTrend(
                [
                    {...row("EUR", 100, "completed"), ends_at: "2026-01-31T23:30:00Z"},
                    {...row("EUR", 50, "paid"), ends_at: "2026-02-01T01:00:00Z"},
                    {...row("AUD", 40, "review"), ends_at: "2026-01-31T23:30:00Z"},
                ],
                "Europe/Berlin",
            ),
        ).toEqual([
            {
                currency: "AUD",
                month: "2026-02",
                expected: 0,
                review: 40,
                completed: 0,
                invoiced: 0,
                paid: 0,
            },
            {
                currency: "EUR",
                month: "2026-02",
                expected: 0,
                review: 0,
                completed: 100,
                invoiced: 0,
                paid: 50,
            },
        ]);
    });
    it("groups company invoice, received and outstanding totals by original currency", () => {
        const trend = monthlyInvoiceTrend([
            invoice("company-a", {
                issued_on: "2026-01-10",
                total_amount: 100,
                paid_amount: 25,
            }),
            invoice("company-b", {
                issued_on: "2026-01-20",
                total_amount: 50,
                paid_amount: 0,
            }),
            invoice("company-aud", {
                issued_on: "2026-01-15",
                currency: "AUD",
                total_amount: 80,
                paid_amount: 80,
                status: "paid",
            }),
            invoice("company-rejected", {
                issued_on: "2026-01-12",
                total_amount: 70,
                paid_amount: 0,
                status: "rejected",
            }),
        ]);
        expect(trend).toEqual([
            {
                currency: "AUD",
                month: "2026-01",
                invoiced: 80,
                paid: 80,
                outstanding: 0,
            },
            {
                currency: "EUR",
                month: "2026-01",
                invoiced: 150,
                paid: 25,
                outstanding: 125,
            },
        ]);
    });
});