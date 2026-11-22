import { z } from "zod";

export const lecturerBlockOrganisation = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(200),
});

export const lecturerBlockVersion = z.int().nonnegative().max(2_147_483_647);

export const companyLecturerBlock = z.strictObject({
  lecturer_id: z.uuid(),
  display_name: z.string(),
  blocked: z.boolean(),
  version: lecturerBlockVersion,
});

export const companyLecturerBlocks = z.strictObject({
  organisation_id: z.uuid(),
  can_write: z.boolean(),
  rows: z.array(companyLecturerBlock).max(40),
  more: z.boolean(),
});

export const lecturerBlockSearch = z.string().max(120);
export type CompanyLecturerBlock = z.infer<typeof companyLecturerBlock>;
export type LecturerBlockOrganisation = z.infer<
  typeof lecturerBlockOrganisation
>;
