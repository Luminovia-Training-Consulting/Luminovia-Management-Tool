import { z } from "zod";
import {
  companyLecturerBlock,
  companyLecturerBlocks,
  lecturerBlockOrganisation,
  lecturerBlockSearch,
  lecturerBlockVersion,
} from "../operations/company-lecturer-block-schema.ts";

const security = [{ apiKey: [], bearerAuth: [] }];
const tags = ["Company lecturer restrictions"];
const rpcError = z.strictObject({
  code: z.string(),
  message: z.string(),
  hint: z.string().nullable(),
  details: z.string().nullable(),
});
const response = (description: string, schema: z.ZodType) => ({
  description,
  content: { "application/json": { schema: z.toJSONSchema(schema) } },
});
const missingAuthority = response(
  "Current company or organisation management authority required",
  rpcError,
);
const read = {
  operationId: "readCompanyLecturerBlocks",
  tags,
  summary: "Find lecturers and current company restrictions",
  description:
    "Returns current lecturers with assignment history for the caller’s company and existing active blocks. Organisation managers can also find current lecturers without assignment history. Results contain at most forty rows. Narrow the search if more is true.",
  security,
  parameters: [
    {
      name: "p_organisation_id",
      in: "query",
      required: true,
      schema: z.toJSONSchema(z.uuid()),
    },
    {
      name: "p_search",
      in: "query",
      required: false,
      schema: z.toJSONSchema(lecturerBlockSearch.default("")),
    },
  ],
  responses: {
    "200": response(
      "Current state for the chosen organisation",
      companyLecturerBlocks,
    ),
    "400": response("Invalid lecturer search", rpcError),
    "403": missingAuthority,
  },
};
const write = {
  operationId: "setCompanyLecturerBlock",
  tags,
  summary: "Block or unblock a lecturer for one company",
  description:
    "Changes teaching access and new assignment eligibility for this organisation. An existing claim, financial snapshot and audit trail are retained. Supply the revision returned by the list. A retry of the immediately preceding identical change returns its version.",
  security,
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: z.toJSONSchema(
          z.strictObject({
            p_organisation_id: z.uuid(),
            p_lecturer_id: z.uuid(),
            p_blocked: z.boolean(),
            p_expected_version: lecturerBlockVersion,
          }),
        ),
      },
    },
  },
  responses: {
    "200": response(
      "Resulting restriction state and revision",
      companyLecturerBlock,
    ),
    "400": response(
      "Invalid organisation, lecturer, state or version",
      rpcError,
    ),
    "403": missingAuthority,
    "409": response(
      "The lecturer restriction changed since this version",
      rpcError,
    ),
  },
};

export const companyLecturerBlockPaths = {
  "/rest/v1/rpc/company_lecturer_blocks": { get: read },
  "/rest/v1/rpc/set_company_lecturer_block": { post: write },
};

export const academyCompanyLecturerBlockPaths = {
  "/rest/v1/rpc/academy_lecturer_block_organisations": {
    get: {
      operationId: "listAcademyLecturerBlockOrganisations",
      tags,
      summary: "Choose a company authorised for lecturer restrictions",
      description:
        "Lists current company memberships or organisations available under current management authority.",
      security,
      "x-portal-licence": "active-or-grace",
      responses: {
        "200": response(
          "Authorised organisation IDs and names",
          lecturerBlockOrganisation.array(),
        ),
        "403": missingAuthority,
      },
    },
  },
  "/rest/v1/rpc/company_lecturer_blocks": {
    get: { ...read, "x-portal-licence": "active-or-grace" },
  },
  "/rest/v1/rpc/set_company_lecturer_block": {
    post: { ...write, "x-portal-licence": "active" },
  },
};
