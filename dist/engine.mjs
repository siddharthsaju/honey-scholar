export const normalize = (v) =>
  String(v ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
export function isCorrect(q, response) {
  if (q.type === "choice") return response === q.answer;
  return (
    Array.isArray(response) &&
    q.accepted.length === response.length &&
    q.accepted.every((alts, i) =>
      alts.some((a) => normalize(a) === normalize(response[i])),
    )
  );
}
export function result(questions, responses, submitted) {
  const graded = questions.filter((q) =>
    q.type === "choice"
      ? Number.isInteger(q.answer) && q.answer >= 0
      : q.accepted?.every((a) => a.some((x) => normalize(x))),
  );
  const correct = graded.filter(
    (q) => submitted[q.id] && isCorrect(q, responses[q.id]),
  ).length;
  return {
    correct,
    total: questions.length,
    graded: graded.length,
    ungraded: questions.length - graded.length,
    percent: graded.length ? (correct / graded.length) * 100 : null,
    // Exactly 90% does not qualify for the celebration.
    celebrate: graded.length > 0 && correct / graded.length > 0.9,
  };
}
export function parseKey(text) {
  const map = {};
  const lines = text
    .replace(/\r/g, "")
    .replace(/[ \t]+(?=\d+[.)]\s)/g, "\n")
    .split("\n");
  for (const line of lines) {
    const m = line
      .trim()
      .match(/^(?:Q(?:uestion)?\s*)?(\d+)\s*[.):\-]\s*(.+)$/i);
    if (m) map[m[1]] = m[2].trim();
  }
  return map;
}
export function parseWorksheet(text, key = {}) {
  const cleaned = text
    .replace(/\r/g, "")
    .replace(/[ \t]+(?=[A-Ha-h][.)]\s)/g, "\n");
  const lines = cleaned.split("\n");
  let current = null;
  const groups = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^(?:Q(?:uestion)?\s*)?(\d+)\s*[.)]\s*(.+)$/i);
    if (match) {
      current = { number: match[1], lines: [match[2]] };
      groups.push(current);
    } else if (current) current.lines.push(line);
  }
  return groups.map((g, i) => {
    let prompt = [],
      options = [],
      lastOption = false;
    for (const line of g.lines) {
      const o = line.match(/^([A-Ha-h])[.)]\s*(.+)$/);
      if (o) {
        options.push(o[2]);
        lastOption = true;
      } else if (lastOption) {
        options[options.length - 1] += " " + line;
      } else prompt.push(line);
    }
    const stem = prompt.join(" ");
    const rawAnswer = key[g.number] || "";
    const type = options.length >= 2 ? "choice" : "blank";
    const count = Math.max(1, (stem.match(/_{2,}|\[blank\]/gi) || []).length);
    const letter = rawAnswer
      .match(/^([A-Ha-h])(?:[.)\s]|$)/)?.[1]
      ?.toUpperCase();
    let answer = letter
      ? letter.charCodeAt(0) - 65
      : options.findIndex((o) => normalize(o) === normalize(rawAnswer));
    if (answer >= options.length) answer = -1;
    return {
      id: "q" + i,
      number: g.number,
      prompt: stem,
      type,
      options,
      answer,
      accepted: Array.from({ length: count }, (_, j) =>
        (rawAnswer.split("|")[j] || "")
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
      source: rawAnswer ? "Answer key" : "Needs answer",
      note: "",
    };
  });
}
export function answerText(q) {
  return q.type === "choice"
    ? q.answer >= 0
      ? `${String.fromCharCode(65 + q.answer)}. ${q.options[q.answer]}`
      : "No answer supplied"
    : q.accepted.map((a) => a.join(" / ") || "No answer supplied").join(" · ");
}
export const demoQuestions = [
  {
    id: "q0",
    number: "1",
    type: "choice",
    prompt: "Which part of a plant absorbs water and minerals from the soil?",
    options: ["The flowers", "The roots", "The leaves", "The stem"],
    answer: 1,
    accepted: [],
    source: "Demo answer key",
    note: "Roots anchor the plant and absorb water and dissolved minerals from the soil.",
  },
  {
    id: "q1",
    number: "2",
    type: "blank",
    prompt:
      "The process by which plants make food using sunlight is called _____.",
    options: [],
    answer: -1,
    accepted: [["photosynthesis"]],
    source: "Demo answer key",
    note: "Photosynthesis uses light energy to turn carbon dioxide and water into sugars.",
  },
  {
    id: "q2",
    number: "3",
    type: "choice",
    prompt: "Which gas do plants take in during photosynthesis?",
    options: ["Oxygen", "Nitrogen", "Carbon dioxide", "Helium"],
    answer: 2,
    accepted: [],
    source: "Demo answer key",
    note: "Plants take in carbon dioxide and release oxygen during photosynthesis.",
  },
  {
    id: "q3",
    number: "4",
    type: "blank",
    prompt: "The green pigment that absorbs light in plants is _____.",
    options: [],
    answer: -1,
    accepted: [["chlorophyll"]],
    source: "Demo answer key",
    note: "Chlorophyll is found in chloroplasts and absorbs light for photosynthesis.",
  },
  {
    id: "q4",
    number: "5",
    type: "choice",
    prompt: "What is the main role of a flower in a flowering plant?",
    options: [
      "Absorbing minerals",
      "Storing sunlight",
      "Transporting water",
      "Reproduction",
    ],
    answer: 3,
    accepted: [],
    source: "Demo answer key",
    note: "Flowers contain reproductive structures that help the plant produce seeds.",
  },
];
