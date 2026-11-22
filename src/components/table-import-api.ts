import { requireOnline } from "../lib/online";
import { db } from "../lib/supabase";

export async function importTableRow(
  key: string,
  kind:
    | "course-template"
    | "course-draft"
    | "company"
    | "contact"
    | "taxonomy"
    | "enrolment",
  payload: object,
  scope: string | null = null,
) {
  requireOnline();
  const { data, error } = await db().rpc("import_table_row", {
    p_row_key: key,
    p_kind: kind,
    p_scope: scope,
    p_payload: payload,
  });
  if (error) throw error;
  if (data !== true) throw new Error("Import row was not confirmed");
}
