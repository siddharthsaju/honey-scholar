import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker, { identity, validateTest } from "../server/worker.mjs";
import { progressStats } from "../dist/account-stats.mjs";
const schema = readFileSync(
  new URL("../migrations/0001_accounts.sql", import.meta.url),
  "utf8",
);
const fixture = {
  title: "Biology",
  questions: [
    {
      id: "q0",
      number: "1",
      type: "choice",
      prompt: "A question?",
      options: ["No", "Yes"],
      answer: 1,
      accepted: [],
      source: "Key",
      note: "",
    },
  ],
  responses: { q0: 0 },
  submitted: { q0: true },
  finished: true,
};
function dbAdapter() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(schema);
  return {
    sql,
    prepare(query) {
      return {
        bind(...args) {
          return {
            first: async () => sql.prepare(query).get(...args),
            all: async () => ({ results: sql.prepare(query).all(...args) }),
            run: async () => sql.prepare(query).run(...args),
          };
        },
        first: async () => sql.prepare(query).get(),
        all: async () => ({ results: sql.prepare(query).all() }),
        run: async () => sql.prepare(query).run(),
      };
    },
    batch: async (ops) => Promise.all(ops.map((o) => o.run())),
  };
}
const token = (uid) =>
  `header.${Buffer.from(JSON.stringify({ sub: uid, aud: "test-project", iss: "https://securetoken.google.com/test-project", exp: Date.now() / 1000 + 3600, auth_time: Date.now() / 1000 })).toString("base64url")}.signature`;
test("dashboard excludes retakes and ungraded initial tests from score average", () => {
  const s = progressStats([
    { finished: 1, practice: 0, graded: 10, correct: 4, created_at: 1 },
    { finished: 1, practice: 1, graded: 10, correct: 10, created_at: 2 },
    { finished: 1, practice: 0, graded: 0, correct: 0, created_at: 3 },
  ]);
  assert.equal(s.average, 40);
  assert.equal(s.completed, 2);
  assert.equal(s.practice, 1);
  assert.equal(s.points.length, 1);
});
test("saved data is whitelisted and score is recomputed", () => {
  const t = validateTest({
    state: { ...fixture, score: 100, password: "secret", pdf: "raw" },
    topic: "Biology",
  });
  assert.equal(t.score.correct, 0);
  assert.equal(t.state.password, undefined);
  assert.equal(t.state.pdf, undefined);
});
test("verified project membership and email required", async () => {
  const req = new Request("https://site/api/me", {
    headers: { Authorization: "Bearer " + token("u") },
  });
  await assert.rejects(
    identity(
      req,
      { FIREBASE_PROJECT_ID: "another", FIREBASE_API_KEY: "public" },
      async () =>
        Response.json({
          users: [{ localId: "u", email: "a@b.com", emailVerified: true }],
        }),
    ),
    /Invalid sign-in/,
  );
  await assert.rejects(
    identity(req, { FIREBASE_PROJECT_ID: "test-project" }, async () =>
      Response.json({
        users: [{ localId: "u", email: "a@b.com", emailVerified: false }],
      }),
    ),
    /Verify your email/,
  );
});
test("API isolates users, locks scores and rejects non-admin access", async () => {
  const DB = dbAdapter(),
    env = {
      DB,
      FIREBASE_PROJECT_ID: "test-project",
      FIREBASE_API_KEY: "public",
      ADMIN_EMAIL: "admin@example.com",
    };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const t = JSON.parse(options.body).idToken;
    const uid = JSON.parse(Buffer.from(t.split(".")[1], "base64url")).sub;
    return Response.json({
      users: [
        { localId: uid, email: uid + "@example.com", emailVerified: true },
      ],
    });
  };
  const req = async (
    uid,
    path,
    method = "GET",
    data,
    origin = "https://site",
  ) =>
    worker.fetch(
      new Request("https://site/api" + path, {
        method,
        headers: {
          Authorization: "Bearer " + token(uid),
          Origin: origin,
          "Content-Type": "application/json",
        },
        body: data ? JSON.stringify(data) : undefined,
      }),
      env,
      {},
    );
  try {
    assert.equal(
      (await worker.fetch(new Request("https://site/api/me"), env, {})).status,
      401,
    );
    await req("alice", "/me", "POST", { consent: true });
    await req("bob", "/me", "POST", { consent: true });
    await req("admin", "/me", "POST", { consent: true });
    assert.equal(
      (
        await req("alice", "/tests/attempt001", "PUT", {
          state: fixture,
          topic: "Biology",
        })
      ).status,
      200,
    );
    assert.equal((await req("bob", "/tests/attempt001")).status, 404);
    assert.equal((await req("bob", "/tests")).status, 200);
    assert.deepEqual(await (await req("bob", "/tests")).json(), []);
    assert.equal(
      (
        await req("alice", "/tests/attempt001", "PUT", {
          state: { ...fixture, responses: { q0: 1 } },
        })
      ).status,
      409,
    );
    const retry = await (
      await req("alice", "/tests/attempt002", "PUT", {
        state: { ...fixture, responses: { q0: 1 } },
        topic: "Biology",
      })
    ).json();
    assert.equal(retry.practice, true);
    const data = await (await req("alice", "/tests")).json();
    assert.equal(progressStats(data).average, 0);
    assert.equal((await req("alice", "/admin")).status, 403);
    const admin = await (await req("admin", "/admin")).json();
    assert.equal(admin.totals.accounts, 3);
    assert.equal(admin.totals.completed, 1);
    assert.deepEqual(Object.keys(admin.members[0]).sort(), [
      "created_at",
      "email",
      "last_seen",
    ]);
    assert.equal(
      (
        await req(
          "alice",
          "/me",
          "PUT",
          { favourites: ["Chemistry"] },
          "https://evil",
        )
      ).status,
      403,
    );
    const ongoing = {
      ...fixture,
      finished: false,
      questions: [{ ...fixture.questions[0], prompt: "Another question" }],
    };
    await req("alice", "/tests/attempt003", "PUT", { state: ongoing });
    assert.equal(
      (
        await req("alice", "/tests/attempt003", "PUT", {
          state: { ...ongoing, responses: { q0: 1 } },
        })
      ).status,
      409,
    );
    const exported = await (await req("alice", "/export")).json();
    assert.equal(exported.profile.email, "alice@example.com");
    assert.equal(exported.tests.length, 3);
    assert.equal(
      (await req("bob", "/account", "DELETE", { confirm: "wrong" })).status,
      400,
    );
    assert.equal(
      (await req("bob", "/account", "DELETE", { confirm: "DELETE" })).status,
      200,
    );
    assert.equal(
      DB.sql.prepare("SELECT COUNT(*) AS n FROM members WHERE uid=?").get("bob")
        .n,
      0,
    );
    assert.equal(
      DB.sql
        .prepare("SELECT COUNT(*) AS n FROM saved_tests WHERE uid=?")
        .get("alice").n,
      3,
    );
  } finally {
    globalThis.fetch = original;
    DB.sql.close();
  }
});
