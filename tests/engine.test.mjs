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
