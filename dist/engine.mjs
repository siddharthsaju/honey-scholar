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
// PDF.js supplies explicit spaces as well as adjacent text fragments.
export function pdfTextRows(items) {
  const rows = [];
  let row = "",
    lastY = null,
    right = null;
  for (const item of items) {
    if (!("str" in item)) continue;
    const [, , , , x, y] = item.transform;
    if (lastY !== null && Math.abs(y - lastY) > 3 && row) {
      rows.push(row);
      row = "";
      right = null;
    }
    if (
      row &&
      item.str &&
      !/\s$/.test(row) &&
      !/^\s/.test(item.str) &&
      right !== null &&
      x - right > 1
    )
      row += " ";
    row += item.str;
    right = x + item.width;
    lastY = y;
    if (item.hasEOL) {
      if (row) rows.push(row);
      row = "";
      lastY = right = null;
    }
  }
  if (row) rows.push(row);
  return rows.join("\n");
}

function inlineChoices(line, upper) {
  const pattern = upper
    ? /(?:^|[ \t]+)([A-H])[.)]\s+/g
    : /(?:^|[ \t]+)([a-h])[.)]\s+/g;
  const matches = [...line.matchAll(pattern)].filter((m) => {
    // A. inside a quoted author name is content, not an option label.
    const before = line.slice(0, m.index);
    return (before.match(/(?<!\\)"/g) || []).length % 2 === 0;
  });
  if (
    matches.length < 2 ||
    matches[0][1].toUpperCase() !== "A" ||
    !matches.every((m, i) => m[1].toUpperCase().charCodeAt(0) === 65 + i)
  )
    return [line];
  const rows = [];
  let at = 0;
  for (const m of matches) {
    if (m.index > at) rows.push(line.slice(at, m.index).trim());
    at = m.index + m[0].search(/[A-Ha-h]/);
  }
  rows.push(line.slice(at));
  return rows.filter(Boolean);
}

export function parseWorksheet(text, key = {}) {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim());
  const heading = /^(?:Question|Q)\s*(\d+)(?:\s*[.):|–—-]\s*(.*))?$/i;
  // Explicit question headings take precedence over numbers inside code/options.
  const explicit = lines.some((line) => heading.test(line));
  const groups = [];
  let current = null;
  for (const line of lines) {
    if (!line) continue;
    const match = line.match(explicit ? heading : /^(\d+)\s*[.)]\s+(.+)$/);
    if (match) {
      const title = (match[2] || "").replace(
        /^\d+(?:\.\d+)?\s*(?:points?|marks?)\s*$/i,
        "",
      );
      current = { number: match[1], lines: title ? [title] : [] };
      groups.push(current);
    } else if (/^Answer\s*:\s*[_ .…]+$/i.test(line)) {
      // Printed response lines end the question; page footers aren't content.
      current = null;
    } else if (current) current.lines.push(line);
  }
  return groups.map((g, i) => {
    let prompt = [],
      options = [],
      lastOption = false;
    const upper =
      g.lines.some((line) => /^A[.)]\s/.test(line)) ||
      g.lines.some((line) => inlineChoices(line, true).length > 1);
    const optionPattern = upper
      ? /^([A-H])[.)]\s+(.+)$/
      : /^([a-h])[.)]\s+(.+)$/;
    for (const line of g.lines.flatMap((line) => inlineChoices(line, upper))) {
      const o = line.match(optionPattern);
      if (o && o[1].toUpperCase().charCodeAt(0) === 65 + options.length) {
        options.push(o[2]);
        lastOption = true;
      } else if (lastOption) options[options.length - 1] += " " + line;
      else prompt.push(line);
    }
    const stem = prompt.join("\n");
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
