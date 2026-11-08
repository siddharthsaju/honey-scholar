import { result } from "../dist/engine.mjs";
const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const text = (v, max = 160) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
export function validateTest(body) {
  const raw = body?.state;
  if (
    !raw ||
    !Array.isArray(raw.questions) ||
    !raw.questions.length ||
    raw.questions.length > 200
  )
    fail(400, "Save between 1 and 200 questions.");
  const ids = new Set();
  const questions = raw.questions.map((q) => {
    const id = text(q.id, 60);
    if (!id || ids.has(id) || !["choice", "blank"].includes(q.type))
      fail(400, "Invalid question.");
    ids.add(id);
    const options = Array.isArray(q.options)
      ? q.options.map((x) => text(x, 2000)).slice(0, 20)
      : [];
    const accepted = Array.isArray(q.accepted)
      ? q.accepted
          .slice(0, 30)
          .map((a) =>
            Array.isArray(a) ? a.slice(0, 30).map((x) => text(x, 500)) : [],
          )
      : [];
    if (q.type === "choice" && options.length < 2)
      fail(400, "A question needs at least two choices.");
    if (q.type === "blank" && !accepted.length)
      fail(400, "A blank question needs at least one blank.");
    return {
      id,
      type: q.type,
      prompt: text(q.prompt, 10000),
      number: text(String(q.number), 30),
      options,
      accepted,
      answer:
        Number.isInteger(q.answer) && q.answer >= 0 && q.answer < options.length
          ? q.answer
          : -1,
      note: text(q.note, 5000),
      source: text(q.source, 200),
    };
  });
  const responses = Object.create(null),
    submitted = Object.create(null);
  for (const q of questions) {
    const r = raw.responses?.[q.id];
    responses[q.id] =
      q.type === "choice"
        ? Number.isInteger(r) && r >= 0 && r < q.options.length
          ? r
          : null
        : Array.isArray(r)
          ? r.slice(0, 30).map((x) => text(x, 1000))
          : [];
    submitted[q.id] = raw.submitted?.[q.id] === true;
  }
  const finished = raw.finished === true;
  const state = {
    title: text(raw.title) || "Untitled worksheet",
    questions,
    responses,
    submitted,
    index: Math.max(
      0,
      Math.min(
        questions.length - 1,
        Number.isInteger(raw.index) ? raw.index : 0,
      ),
    ),
    all: false,
    finished,
    view: finished ? "review" : "quiz",
    ai: raw.ai === true,
    timerEnabled: raw.timerEnabled === true,
    timerMinutes: Math.max(1, Math.min(180, Number(raw.timerMinutes) || 10)),
    deadline: Number.isFinite(raw.deadline) ? raw.deadline : null,
    timedOut: raw.timedOut === true,
  };
  state.practice = raw.practice === true;
  return {
    state,
    topic: text(body.topic, 60) || "Uncategorised",
    score: result(questions, responses, submitted),
  };
}
export async function identity(request, env, fetcher = fetch) {
  const token = request.headers
    .get("Authorization")
    ?.match(/^Bearer (\S+)$/)?.[1];
  if (!token || token.length > 12000) fail(401, "Please sign in.");
  const r = await fetcher(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    },
  );
  if (!r.ok) fail(r.status === 429 ? 503 : 401, "Please sign in again.");
  const u = (await r.json()).users?.[0];
  if (!u?.localId || u.disabled || u.emailVerified !== true || !u.email)
    fail(403, "Verify your email before saving progress.");
  let claims;
  try {
    claims = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
  } catch {
    fail(401, "Invalid sign-in token.");
  }
  if (
    claims.aud !== env.FIREBASE_PROJECT_ID ||
    claims.iss !==
      `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}` ||
    claims.sub !== u.localId ||
    claims.exp <= Date.now() / 1000
  )
    fail(401, "Invalid sign-in token.");
  // Trust claims only after Google's account lookup has verified this token.
  return {
    uid: u.localId,
    email: u.email,
    admin:
      u.email.toLowerCase() === String(env.ADMIN_EMAIL || "").toLowerCase(),
    token,
  };
}
async function body(request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    fail(415, "Send JSON data.");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "Missing data.");
  let n = 0,
    parts = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > 350000) {
      await reader.cancel();
      fail(413, "This saved test is too large.");
    }
    parts.push(value);
  }
  try {
    return JSON.parse(await new Blob(parts).text());
  } catch {
    fail(400, "Invalid data.");
  }
}
async function limit(db, key, max) {
  const window = Math.floor(Date.now() / 60000);
  const r = await db
    .prepare(
      "INSERT INTO request_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END, window=excluded.window RETURNING count",
    )
    .bind(key, window)
    .first();
  if (r.count > max) fail(429, "Please wait a minute and try again.");
}
export const publicAuthConfig = {
  FIREBASE_API_KEY: "",
  FIREBASE_PROJECT_ID: "",
  FIREBASE_AUTH_DOMAIN: "",
  FIREBASE_APP_ID: "",
  ADMIN_EMAIL: "",
};
export async function handle(request, env, ctx) {
  env = { ...publicAuthConfig, ...env };
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
  if (path === "/api/config" && method === "GET")
    return json({
      enabled: !!(env.DB && env.FIREBASE_PROJECT_ID && env.FIREBASE_API_KEY),
      firebase: {
        apiKey: env.FIREBASE_API_KEY,
        projectId: env.FIREBASE_PROJECT_ID,
        authDomain: env.FIREBASE_AUTH_DOMAIN,
        appId: env.FIREBASE_APP_ID,
      },
    });
  if (!env.DB || !env.FIREBASE_API_KEY)
    fail(
      503,
      "Accounts are being set up. You can still study without signing in.",
    );
  if (!["GET", "POST", "PUT", "DELETE"].includes(method))
    fail(405, "Method not supported.");
  if (method !== "GET" && request.headers.get("Origin") !== url.origin)
    fail(403, "Request origin rejected.");
  const u = await identity(request, env);
  if (method !== "GET") await limit(env.DB, u.uid, 30);
  const now = Date.now();
  if (path === "/api/me" && method === "POST") {
    const input = await body(request);
    if (input.consent !== true)
      fail(400, "Please accept saving your account details.");
    await env.DB.prepare(
      "INSERT INTO members(uid,email,created_at,last_seen) VALUES(?,?,?,?) ON CONFLICT(uid) DO UPDATE SET email=excluded.email,last_seen=excluded.last_seen",
    )
      .bind(u.uid, u.email, now, now)
      .run();
    return json({ email: u.email, admin: u.admin });
  }
  const member = await env.DB.prepare(
    "SELECT uid,email,created_at,last_seen,favourites FROM members WHERE uid=?",
  )
    .bind(u.uid)
    .first();
  if (!member) fail(404, "Create your study profile first.");
  if (path === "/api/me" && method === "GET")
    return json({
      ...member,
      favourites: JSON.parse(member.favourites),
      admin: u.admin,
    });
  if (path === "/api/me" && method === "PUT") {
    const input = await body(request);
    if (!Array.isArray(input.favourites) || input.favourites.length > 20)
      fail(400, "Choose up to 20 favourite topics.");
    const favourites = [
      ...new Set(input.favourites.map((x) => text(x, 60)).filter(Boolean)),
    ];
    await env.DB.prepare("UPDATE members SET favourites=? WHERE uid=?")
      .bind(JSON.stringify(favourites), u.uid)
      .run();
    return json({ favourites });
  }
  if (path === "/api/tests" && method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id,title,topic,finished,correct,graded,total,practice,created_at,updated_at FROM saved_tests WHERE uid=? ORDER BY updated_at DESC LIMIT 500",
    )
      .bind(u.uid)
      .all();
    return json(rows.results);
  }
  const match = path.match(/^\/api\/tests\/([a-zA-Z0-9_-]{8,80})$/);
  if (match) {
    const id = match[1];
    const old = await env.DB.prepare(
      "SELECT * FROM saved_tests WHERE uid=? AND id=?",
    )
      .bind(u.uid, id)
      .first();
    if (method === "GET") {
      if (!old) fail(404, "Saved test not found.");
      return json({ id, topic: old.topic, state: JSON.parse(old.payload) });
    }
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM saved_tests WHERE uid=? AND id=?")
        .bind(u.uid, id)
        .run();
      return json({ deleted: true });
    }
    if (method === "PUT") {
      const t = validateTest(await body(request));
      if (old?.finished)
        fail(
          409,
          "This finished attempt is locked. Start a fresh attempt to save another result.",
        );
      if (old) {
        const previous = JSON.parse(old.payload);
        if (
          JSON.stringify(previous.questions) !==
          JSON.stringify(t.state.questions)
        )
          fail(409, "Saved question sets cannot change during an attempt.");
        for (const q of previous.questions)
          if (
            previous.submitted[q.id] &&
            (!t.state.submitted[q.id] ||
              JSON.stringify(previous.responses[q.id]) !==
                JSON.stringify(t.state.responses[q.id]))
          )
            fail(409, "Submitted answers are locked.");
      }
      const canonical = JSON.stringify(
        t.state.questions.map((q) => ({
          type: q.type,
          prompt: q.prompt,
          options: q.options,
          answer: q.answer,
          accepted: q.accepted,
        })),
      );
      const fingerprint = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(canonical),
          ),
        ),
        (x) => x.toString(16).padStart(2, "0"),
      ).join("");
      const first = await env.DB.prepare(
        "SELECT id FROM saved_tests WHERE uid=? AND fingerprint=? AND practice=0",
      )
        .bind(u.uid, fingerprint)
        .first();
      const practice = old ? old.practice : Number(t.state.practice || !!first);
      t.state.practice = !!practice;
      // Atomic insert condition enforces the storage cap even for simultaneous requests.
      const write = await env.DB.prepare(
        "INSERT INTO saved_tests(uid,id,fingerprint,title,topic,payload,finished,correct,graded,total,practice,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM saved_tests WHERE uid=?)<500 OR EXISTS(SELECT 1 FROM saved_tests WHERE uid=? AND id=?) ON CONFLICT(uid,id) DO UPDATE SET title=excluded.title,topic=excluded.topic,payload=excluded.payload,finished=excluded.finished,correct=excluded.correct,graded=excluded.graded,total=excluded.total,updated_at=excluded.updated_at WHERE saved_tests.finished=0 AND saved_tests.payload=?",
      )
        .bind(
          u.uid,
          id,
          fingerprint,
          t.state.title,
          t.topic,
          JSON.stringify(t.state),
          Number(t.state.finished),
          t.score.correct,
          t.score.graded,
          t.score.total,
          practice,
          now,
          now,
          u.uid,
          u.uid,
          id,
          old?.payload || "",
        )
        .run();
      if ((write.meta?.changes ?? write.changes) === 0)
        fail(
          409,
          "This attempt changed in another tab, or your saved-test limit was reached. Reload your saved progress.",
        );
      const saved = await env.DB.prepare(
        "SELECT id FROM saved_tests WHERE uid=? AND id=?",
      )
        .bind(u.uid, id)
        .first();
      if (!saved)
        fail(
          409,
          "You have reached 500 saved tests. Delete an old test first.",
        );
      return json({ id, practice: !!practice });
    }
  }
  if (path === "/api/export" && method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id,topic,payload,created_at,updated_at FROM saved_tests WHERE uid=? ORDER BY created_at",
    )
      .bind(u.uid)
      .all();
    return json({
      profile: {
        email: member.email,
        favourites: JSON.parse(member.favourites),
        created_at: member.created_at,
      },
      tests: rows.results.map((r) => ({
        ...r,
        payload: JSON.parse(r.payload),
      })),
    });
  }
  if (path === "/api/account" && method === "DELETE") {
    const input = await body(request);
    if (input.confirm !== "DELETE") fail(400, "Type DELETE to confirm.");
    const claims = JSON.parse(
      atob(u.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (!claims.auth_time || Date.now() / 1000 - claims.auth_time > 300)
      fail(
        409,
        "Please sign out and sign in again before deleting your account.",
      );
    await env.DB.batch([
      env.DB.prepare("DELETE FROM saved_tests WHERE uid=?").bind(u.uid),
      env.DB.prepare("DELETE FROM members WHERE uid=?").bind(u.uid),
      env.DB.prepare("DELETE FROM request_limits WHERE key=?").bind(u.uid),
    ]);
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: u.token }),
      },
    );
    if (!r.ok)
      fail(
        409,
        "Saved data was deleted, but sign-in removal failed. Sign in and retry account deletion.",
      );
    return json({ deleted: true });
  }
  if (path === "/api/admin" && method === "GET") {
    if (!u.admin) fail(403, "Administrator access required.");
    const offset = Math.max(
      0,
      Math.min(100000, Number.parseInt(url.searchParams.get("offset")) || 0),
    );
    const [totals, tests, members] = await Promise.all([
      env.DB.prepare(
        "SELECT COUNT(*) AS accounts,SUM(CASE WHEN last_seen>? THEN 1 ELSE 0 END) AS active FROM members",
      )
        .bind(now - 30 * 86400000)
        .first(),
      env.DB.prepare(
        "SELECT COUNT(*) AS saved,SUM(CASE WHEN finished=1 AND practice=0 THEN 1 ELSE 0 END) AS completed FROM saved_tests",
      ).first(),
      env.DB.prepare(
        "SELECT email,created_at,last_seen FROM members ORDER BY created_at DESC LIMIT 50 OFFSET ?",
      )
        .bind(offset)
        .all(),
    ]);
    return json({
      totals: { ...totals, ...tests },
      members: members.results,
      offset,
    });
  }
  fail(404, "Not found.");
}
export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (e) {
      return json(
        {
          error: e.status
            ? e.message
            : "Could not complete the request. Please try again.",
        },
        e.status || 500,
      );
    }
  },
};
