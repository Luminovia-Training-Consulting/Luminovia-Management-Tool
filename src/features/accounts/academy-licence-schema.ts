import { z } from "zod";

const count = z.number().int().nonnegative();
const limit = z.number().int().positive();
const instant = z.iso.datetime({ offset: true });

export const academyLicenceReceiptSchema = z.strictObject({
  state: z.enum(["active", "grace"]),
  issued_at: instant,
  starts_at: instant,
  expires_at: instant,
  grace_until: instant,
  seats: z.strictObject({
    limit,
    occupied: count,
    available: count,
  }),
  storage: z.strictObject({
    limit_bytes: limit,
    used_bytes: count,
    available_bytes: count,
  }),
  api_requests_per_minute: limit,
});

export type AcademyLicenceReceipt = z.infer<typeof academyLicenceReceiptSchema>;
