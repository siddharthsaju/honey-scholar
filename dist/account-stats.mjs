export function progressStats(tests) {
  const initial = tests.filter((t) => t.finished && !t.practice);
  const scored = initial.filter((t) => t.graded > 0);
  const percentages = scored.map((t) => (100 * t.correct) / t.graded);
  return {
    completed: initial.length,
    practice: tests.filter((t) => t.finished && t.practice).length,
    inProgress: tests.filter((t) => !t.finished).length,
    average: percentages.length
      ? percentages.reduce((a, b) => a + b, 0) / percentages.length
      : null,
    best: percentages.length ? Math.max(...percentages) : null,
    points: [...scored].sort((a, b) => a.created_at - b.created_at),
  };
}
