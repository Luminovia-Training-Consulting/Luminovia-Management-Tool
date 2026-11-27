import { skipToken } from "@tanstack/react-query";

export const changeCandidatesQuery = (actor: string) => ({
  queryKey: ["academy", "course-offer-candidates", actor],
  queryFn: skipToken,
});

export const lifecycleQuery = (actor: string, job: string) => ({
  queryKey: ["academy", "course-offer-lifecycle", actor, job],
  queryFn: skipToken,
});

export async function refreshJobState() {}

export function OfferPublicationAction() {
  return null;
}
