/** Only bank-only candidate sets can opt into an exact draw smaller than the pool. */
export function quizPoolDrawCount(
  value: number,
  candidateCount: number,
  bankCount: number,
) {
  return bankCount === candidateCount &&
    Number.isInteger(value) &&
    value >= 1 &&
    value < candidateCount &&
    candidateCount <= 20
    ? value
    : null;
}
