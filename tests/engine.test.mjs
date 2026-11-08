import test from "node:test";
import assert from "node:assert/strict";
import {
  parseWorksheet,
  parseKey,
  isCorrect,
  result,
} from "../dist/engine.mjs";
test("extract choices and match original answer numbers", () => {
  const qs = parseWorksheet(
    "5. Pick a fruit. A. Apple B. Stone\n6. Plants use _____.",
    parseKey("5. A\n6. sunlight"),
  );
  assert.equal(qs.length, 2);
  assert.equal(qs[0].answer, 0);
  assert.deepEqual(qs[0].options, ["Apple", "Stone"]);
  assert.ok(isCorrect(qs[1], ["  SUNLIGHT "]));
});
test("multiple blanks require ordered answers and allow alternatives", () => {
  const [q] = parseWorksheet(
    "1. _____ and _____",
    parseKey("1. water; H2O | carbon dioxide; CO2"),
  );
  assert.ok(isCorrect(q, ["h2o", " CO2 "]));
  assert.ok(!isCorrect(q, ["CO2", "H2O"]));
  assert.ok(!isCorrect(q, ["water"]));
});
test("strict confetti boundary and current submitted answers", () => {
  const questions = Array.from({ length: 10 }, (_, i) => ({
    id: "q" + i,
    type: "choice",
    answer: 0,
  }));
  const responses = {},
    submitted = {};
  for (let i = 0; i < 10; i++) {
    responses["q" + i] = i === 9 ? 1 : 0;
    submitted["q" + i] = true;
  }
  assert.equal(result(questions, responses, submitted).percent, 90);
  assert.equal(result(questions, responses, submitted).celebrate, false);
  responses.q9 = 0;
  assert.equal(result(questions, responses, submitted).celebrate, true);
  delete submitted.q9;
  assert.equal(result(questions, responses, submitted).percent, 90);
  questions[9].answer = -1;
  assert.equal(result(questions, responses, submitted).ungraded, 1);
  assert.equal(result(questions, responses, submitted).percent, 100);
  assert.equal(result(questions, responses, submitted).celebrate, true);
});
test("unknown answers and an empty quiz never celebrate", () => {
  assert.equal(result([], {}, {}).percent, null);
  assert.equal(
    result([{ id: "q0", type: "blank", accepted: [[]] }], {}, {}).graded,
    0,
  );
  assert.equal(result([], {}, {}).celebrate, false);
});

test("explicit headings preserve subquestions, wrapped code and four choices", () => {
  const qs = parseWorksheet(
    `Question 1 | 2 points
What is the value?
a. Consider the first expression.
b. Consider the second expression.
Book b = new Book("A. Writer", 200);
A. a. 7, b. 10
B. a. 7, b. 7
C. a. 4, b. 3
D. a. 3, b. 4
Answer: ______
Course footer 2
Question 2 | 2 points
Identify the constructor.
A. Book("A. Writer",
200) = constructor call.
B. Other
C. Third
D. Fourth
Answer: ______`,
    parseKey("1. A\n2. A"),
  );
  assert.equal(qs.length, 2);
  assert.deepEqual(
    qs.map((q) => q.number),
    ["1", "2"],
  );
  assert.deepEqual(qs[0].options, [
    "a. 7, b. 10",
    "a. 7, b. 7",
    "a. 4, b. 3",
    "a. 3, b. 4",
  ]);
  assert.ok(qs[0].prompt.includes('\nBook b = new Book("A. Writer", 200);'));
  assert.ok(qs[0].prompt.includes("a. Consider"));
  assert.equal(qs[1].options[0], 'Book("A. Writer", 200) = constructor call.');
  assert.ok(!JSON.stringify(qs).includes("Course footer"));
});

test("lowercase choices and bare Question headings remain supported", () => {
  const qs = parseWorksheet(
    "Question 1\nChoose a fruit.\na. Apple\nb. Stone\nQuestion 2\nFill ____.",
  );
  assert.deepEqual(qs[0].options, ["Apple", "Stone"]);
  assert.equal(qs[1].type, "blank");
});

test("PDF text fragments retain original spaces inside strings", async () => {
  const { pdfTextRows } = await import("../dist/engine.mjs");
  const pieces = [
    ['"London', 0, 7],
    [" ", 7, 1],
    ['UK";', 8, 4],
    ["next", 0, 4, 20],
    ["word", 6, 4, 20],
  ].map(([str, x, width, y = 30]) => ({
    str,
    width,
    transform: [1, 0, 0, 1, x, y],
  }));
  assert.equal(pdfTextRows(pieces), '"London UK";\nnext word');
});
