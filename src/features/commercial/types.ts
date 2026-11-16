/**
 * DTOs for commercial capabilities, contract versions, fees, invoices and payments. Document
 * versions and accepted claims retain distinct references so template changes cannot reinterpret
 * old agreements.
 */
/** Current commercial view/manage capabilities, not a UI role hierarchy. */
export interface CommercialAccess {
  can_submit_invoice: boolean;
  can_manage_contracts: boolean;
  can_manage_finance: boolean;
}
/** Authorized person selection for commercial administration forms. */
export interface CommercialPerson {
  id: string;
  display_name: string;
}
/** Exact contract version with clean document reference, validity and receipt state. */
export interface ContractRecord {
  id: string;
  user_id: string;
  user_name: string;
  title: string;
  kind: "master" | "addendum";
  parent_contract_id: string | null;
  status: "active" | "expired";
  effective_from: string;
  expires_at: string | null;
  version: number;
  document_version_id: string | null;
  document_id: string | null;
  sha256: string | null;
  acknowledged_at: string | null;
  created_at: string;
}
/** Fee projection from accepted agreements, retaining original currency and confirmed billing stage. */
export interface EarningRecord {
  claim_id: string;
  job_id: string;
  lecturer_id: string;
  lecturer_name: string;
  title: string;
  customer_name: string;
  starts_at: string;
  ends_at: string;
  amount: number;
  rate_unit: string;
  total_amount: number;
  currency: "EUR" | "AUD";
  stage: "expected" | "completed" | "invoiced" | "paid";
  invoice_id: string | null;
}
/** Invoice projection with exact PDF version, server-calculated totals and review/payment state. */
export interface InvoiceRecord {
  labels: string[];
  id: string;
  user_id: string;
  user_name: string;
  number: string;
  issued_on: string;
  due_on: string;
  currency: "EUR" | "AUD";
  total_amount: number;
  paid_amount: number;
  status: "submitted" | "approved" | "paid" | "rejected" | "cancelled";
  document_id: string;
  document_version_id: string;
  claim_ids: string[];
  created_at: string;
  note: string | null;
  paid_at: string | null;
}
/** An individual recorded payment or its auditable reversal. */
export interface InvoicePayment {
  id: string;
  amount: number;
  currency: "EUR" | "AUD";
  paid_at: string;
  reference: string;
  recorded_by_name: string;
  created_at: string;
  voided_at?: string | null;
  void_reason?: string | null;
}
