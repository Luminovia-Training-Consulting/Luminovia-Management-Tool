export const companyIntegrationScopes = [
  "courses.read",
  "enrolments.write",
  "reports.read",
] as const;

export type CompanyIntegrationScope = (typeof companyIntegrationScopes)[number];
