/** The editor can only configure real subsets of a bank-only candidate list. */
import { expect, it } from "vitest";
import { quizPoolDrawCount } from "./quiz-pool-schema";

it("accepts one or more questions below the candidate count", () => {
  expect(quizPoolDrawCount(1, 2, 2)).toBe(1);
  expect(quizPoolDrawCount(19, 20, 20)).toBe(19);
});

it("rejects no draw, the whole pool, mixed manual questions and fractional sizes", () => {
  expect(quizPoolDrawCount(0, 2, 2)).toBeNull();
  expect(quizPoolDrawCount(2, 2, 2)).toBeNull();
  expect(quizPoolDrawCount(1, 2, 1)).toBeNull();
  expect(quizPoolDrawCount(1.5, 3, 3)).toBeNull();
  expect(quizPoolDrawCount(3, 21, 21)).toBeNull();
});
