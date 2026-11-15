import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

process.loadEnvFile(".env.test.local");
const url = process.env.SUPABASE_URL;
if (
  !url ||
  !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)
) {
  throw new Error("Local fixtures refuse all remote Supabase URLs.");
}
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const password = process.env.E2E_PASSWORD;
// A missing saved password never authorises resetting an existing account.
const stableId = (name) => {
  const hash = createHash("sha256")
    .update(`luminovia-local-${name}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
async function checked(request, label) {
  const result = await request;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}
const existingUsers = await checked(
  service.auth.admin.listUsers({ perPage: 1000 }),
  "List local users",
);
async function user(email, displayName, role) {
  let account = existingUsers.users.find((entry) => entry.email === email);
  if (account) return { id: account.id, created: false };
  if (!password)
    throw new Error(
      "No bootstrap password is available; existing accounts remain untouched.",
    );
  account = (
    await checked(
      service.auth.admin.createUser({ email, password, email_confirm: true }),
      "Create fictional local user",
    )
  ).user;
  await checked(
    service.from("profiles").upsert({
      id: account.id,
      display_name: displayName,
      bio_de: "Fiktives Profil für die lokale Entwicklung. Keine echte Person.",
      bio_en: "Fictional local development profile. Not a real person.",
      locale: "de",
      time_zone: "Europe/Berlin",
      active: true,
    }),
    "Seed local profile",
  );
  await checked(
    service
      .from("user_roles")
      .upsert({ user_id: account.id, role }, { onConflict: "user_id,role" }),
    "Seed local role",
  );
  return { id: account.id, created: true };
}
const admin = await user(
  "admin@example.invalid",
  "Luminovia Testverwaltung",
  "admin",
);
const names = [
  "Mara Winter",
  "Jonas Lind",
  "Lea Sommer",
  "Timo Berger",
  "Nora West",
  "Milan Roth",
  "Elisa Blum",
  "Oskar Feld",
  "Lina Stern",
  "Emil Bach",
  "Thea Berg",
];
const lecturers = [];
for (let index = 0; index < 11; index++) {
  const id = await user(
    `lecturer${String(index + 1).padStart(2, "0")}@example.invalid`,
    names[index],
    "lecturer",
  );
  lecturers.push(id);
}
await user(
  "participant@example.invalid",
  "Fiktive Kursteilnahme",
  "participant",
);
const topics = [
  {
    id: stableId("python-topic"),
    label_de: "Python",
    label_en: "Python",
    kind: "language",
  },
  {
    id: stableId("linux-topic"),
    label_de: "Linux",
    label_en: "Linux",
    kind: "topic",
  },
  {
    id: stableId("wireshark-topic"),
    label_de: "Wireshark",
    label_en: "Wireshark",
    kind: "tool",
  },
];
await checked(
  service
    .from("topics")
    .upsert(topics, { onConflict: "id", ignoreDuplicates: true }),
  "Seed missing expertise taxonomy",
);
for (const account of lecturers.filter((account) => account.created)) {
  const lecturer = account.id;
  await checked(
    service.from("lecturer_topics").upsert(
      topics.map((topic) => ({
        user_id: lecturer,
        topic_id: topic.id,
        verified: true,
        valid_until: "2030-12-31T23:59:59Z",
      })),
      { onConflict: "user_id,topic_id" },
    ),
    "Seed verified fictional expertise",
  );
  await checked(
    service.from("contracts").upsert({
      id: stableId(`contract-${lecturer}`),
      user_id: lecturer,
      status: "active",
      effective_from: "2026-01-01",
      expires_at: "2030-12-31T23:59:59Z",
      version: 1,
    }),
    "Seed fictional local contract",
  );
}
const start = new Date();
start.setUTCDate(start.getUTCDate() + 7);
start.setUTCHours(8, 0, 0, 0);
const nextDay = (index, hour = 8) => {
  const date = new Date(start);
  date.setUTCDate(date.getUTCDate() + index);
  date.setUTCHours(hour);
  return date.toISOString();
};
const jobs = [
  {
    id: stableId("python-job"),
    title: "Python – Grundlagen in fünf Tagen",
    description:
      "Fiktiver Schulungsauftrag: Variablen, Funktionen, Dateien und ein gemeinsames Praxisprojekt.",
    customer_name: "Beispiel Akademie",
    delivery_type: "online",
    location: "Online – Zugang folgt nach Beauftragung",
    time_zone: "Europe/Berlin",
    status: "published",
    amount: 480,
    currency: "EUR",
    rate_unit: "per_day",
    total_amount: 2400,
    terms:
      "Ausschließlich fiktiver Entwicklungsauftrag. Fünf zusammenhängende Unterrichtstage.",
    terms_version: 1,
    requires_contract: true,
  },
  {
    id: stableId("linux-job"),
    title: "Linux – Praxistag",
    description: "Fiktiver Workshop zu Shell, Dateirechten und Prozessen.",
    customer_name: "Demo Learning Campus",
    delivery_type: "onsite",
    location: "Fiktiver Schulungsraum",
    time_zone: "Europe/Berlin",
    status: "published",
    amount: 520,
    currency: "EUR",
    rate_unit: "per_day",
    total_amount: 520,
    terms: "Ausschließlich fiktiver Entwicklungsauftrag.",
    terms_version: 1,
    requires_contract: true,
  },
];
for (const [index, job] of jobs.entries()) {
  const existing = await checked(
    service.from("jobs").select("id").eq("id", job.id).maybeSingle(),
    "Check seed job",
  );
  if (existing) continue; // Reruns preserve accepted assignments and their snapshots.
  const organisationId = stableId(`${job.id}-organisation`);
  const templateId = stableId(`${job.id}-template`);
  const runId = stableId(`${job.id}-run`);
  await checked(
    service
      .from("organisations")
      .upsert(
        {
          id: organisationId,
          name: job.customer_name,
          time_zone: job.time_zone,
        },
        { onConflict: "id", ignoreDuplicates: true },
      ),
    "Seed missing fictional customer",
  );
  await checked(
    service
      .from("course_templates")
      .upsert(
        { id: templateId, title: job.title, description: job.description },
        { onConflict: "id", ignoreDuplicates: true },
      ),
    "Seed missing course template",
  );
  await checked(
    service
      .from("course_runs")
      .upsert(
        {
          id: runId,
          template_id: templateId,
          organisation_id: organisationId,
          time_zone: job.time_zone,
        },
        { onConflict: "id", ignoreDuplicates: true },
      ),
    "Seed missing course run",
  );
  const count = index === 0 ? 5 : 1;
  const sessions = Array.from({ length: count }, (_, day) => ({
    id: stableId(`${job.id}-session-${day}`),
    starts_at: nextDay(index === 0 ? day : 10),
    ends_at: nextDay(index === 0 ? day : 10, 14),
  }));
  await checked(
    service.from("course_sessions").upsert(
      sessions.map((session) => ({ ...session, course_run_id: runId })),
      { onConflict: "id", ignoreDuplicates: true },
    ),
    "Seed missing linked course sessions",
  );
  await checked(
    service
      .from("jobs")
      .insert({ ...job, course_run_id: runId, created_by: admin.id }),
    "Seed published linked job",
  );
  await checked(
    service
      .from("job_sessions")
      .insert(
        sessions.map((session) => ({
          ...session,
          job_id: job.id,
          course_session_id: session.id,
        })),
      ),
    "Seed job sessions",
  );
  await checked(
    service
      .from("job_requirements")
      .insert({ job_id: job.id, topic_id: topics[index].id }),
    "Seed job requirements",
  );
}
console.log(
  `Initialised missing fictional fixtures; existing accounts, profiles, permissions, MFA and assignments were preserved. No emails were sent. Admin profile ${admin.id.slice(0, 8)}…`,
);
console.log(
  "Use the accounts and generated password in ignored .env.test.local. Never reuse these fixtures in production.",
);
