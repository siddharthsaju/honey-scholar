import { progressStats } from "./account-stats.mjs";
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let auth, sdk, config, profile, bridge, loading;
const date = (v) =>
  new Date(v).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const percent = (n) => (n === null ? "—" : `${Math.round(n * 10) / 10}%`);
function modal(html) {
  bridge.modal(html);
}
function message(s) {
  $("#account-message") && ($("#account-message").textContent = s);
}
async function init() {
  if (auth) return auth;
  if (loading) return loading;
  loading = (async () => {
    const r = await fetch("/api/config");
    config = await r.json();
    if (!config.enabled)
      throw Error(
        "Accounts are being set up. You can still study without signing in.",
      );
    const [{ initializeApp }, lib] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js"),
    ]);
    sdk = lib;
    auth = sdk.getAuth(initializeApp(config.firebase));
    await sdk.setPersistence(auth, sdk.browserSessionPersistence);
    await auth.authStateReady();
    return auth;
  })();
  try {
    return await loading;
  } catch (e) {
    loading = null;
    throw e;
  }
}
async function api(path, method = "GET", data) {
  await init();
  const user = auth.currentUser;
  if (!user) throw Error("Please sign in first.");
  const r = await fetch("/api" + path, {
    method,
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const value = await r.json();
  if (!r.ok)
    throw Object.assign(Error(value.error || "Please try again."), {
      status: r.status,
    });
  return value;
}
function errorText(e) {
  const messages = {
    "auth/invalid-credential": "Email or password not recognised.",
    "auth/email-already-in-use":
      "Unable to create that account. Try signing in or resetting your password.",
    "auth/weak-password": "Choose a password with at least 12 characters.",
    "auth/popup-closed-by-user": "Sign-in was cancelled.",
    "auth/popup-blocked": "Allow the sign-in popup and try again.",
    "auth/too-many-requests":
      "Too many attempts. Wait a little before trying again.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/unauthorized-domain":
      "Sign-in is not configured for this address yet.",
    "auth/network-request-failed":
      "Could not connect. Check your internet connection.",
  };
  return (
    messages[e.code] ||
    (e.code ? "Could not sign in. Please try again." : e.message)
  );
}
export function setupAccounts(callbacks) {
  bridge = callbacks;
  const button = document.createElement("button");
  button.className = "nav-link";
  button.id = "account-link";
  button.textContent = "My progress";
  button.onclick = () => openAccount();
  $("nav").append(button);
}
export function showPrivacy() {
  modal(
    `<h2>Your study data.</h2><p>No account is needed to study. Guest worksheets stay in your browser. We do not upload your original PDFs.</p><p>If you sign in, Google Firebase handles authentication. Honey Scholar stores your email, account dates and favourite topics. Only tests you choose to save are stored in Cloudflare, including their questions, answers, progress and scores.</p><p>The admin dashboard shows account emails, join dates, last account activity and overall usage counts. It does not show private tests or individual scores. The site owner and hosting providers can technically access stored data to operate the service.</p><p>No advertising trackers or Google Analytics are installed. Hosting and sign-in providers may retain security logs. You can export your saved data or delete your account in My progress. Deleted data may remain in provider backups for their retention period.</p><div class="actions"><button class="btn" id="modal-close">Close</button></div>`,
  );
}
export async function openAccount(after) {
  modal(
    `<h2>Your study space.</h2><p id="account-message" role="status">Loading sign-in…</p><button class="btn secondary" id="modal-close">Keep studying</button>`,
  );
  try {
    await init();
    if (auth.currentUser) {
      await signedIn(after);
      return;
    }
    loginForm(after);
  } catch (e) {
    message(errorText(e));
  }
}
function loginForm(after, mode = "signin") {
  modal(
    `<h2>${mode === "signup" ? "Save your progress." : "Welcome back."}</h2><p>An account is optional. Save selected tests and see how your first-attempt scores change over time.</p><form id="account-form"><label class="field">Email<input type="email" id="account-email" autocomplete="email" required maxlength="254"></label><label class="field">Password<input type="password" id="account-password" autocomplete="${mode === "signup" ? "new-password" : "current-password"}" required minlength="${mode === "signup" ? 12 : 1}" maxlength="128"></label>${mode === "signup" ? '<p class="tiny">Use at least 12 characters. Verify your email before saving.</p>' : ""}<label class="consent"><input type="checkbox" id="account-consent" required> Store my account email and the tests I choose to save. <button type="button" class="text-btn tiny" id="auth-privacy">Privacy details</button></label><p id="account-message" role="status"></p><div class="actions"><button class="btn" type="submit">${mode === "signup" ? "Create account" : "Sign in"}</button><button class="btn secondary" type="button" id="google-login">Continue with Google</button></div></form><div class="actions"><button class="text-btn tiny" id="account-mode">${mode === "signup" ? "Already have an account? Sign in" : "Create an account"}</button><button class="text-btn tiny" id="forgot-password">Forgot password?</button><button class="text-btn tiny" id="modal-close">Keep studying</button></div>`,
  );
  $("#auth-privacy").onclick = showPrivacy;
  const run = async (provider) => {
    if (!$("#account-consent").checked) {
      message("Please read and accept the saving choice first.");
      return;
    }
    if (!provider && !$("#account-form").reportValidity()) return;
    const email = $("#account-email").value,
      password = $("#account-password").value;
    $("#account-form")
      .querySelectorAll("button")
      .forEach((b) => (b.disabled = true));
    message("Signing in…");
    const popupHint = provider
      ? setTimeout(
          () =>
            message(
              "Complete the Google window. If none appears, allow popups or open this site in your normal browser.",
            ),
          12000,
        )
      : null;
    try {
      if (provider)
        await sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider());
      else if (mode === "signup") {
        const credential = await sdk.createUserWithEmailAndPassword(
          auth,
          email,
          password,
        );
        await sdk.sendEmailVerification(credential.user);
      } else await sdk.signInWithEmailAndPassword(auth, email, password);
      await signedIn(after);
    } catch (e) {
      message(errorText(e));
      $("#account-form")
        ?.querySelectorAll("button")
        .forEach((b) => (b.disabled = false));
    } finally {
      clearTimeout(popupHint);
    }
  };
  $("#account-form").onsubmit = (e) => {
    e.preventDefault();
    run(false);
  };
  $("#google-login").onclick = () => run(true);
  $("#account-mode").onclick = () =>
    loginForm(after, mode === "signup" ? "signin" : "signup");
  $("#forgot-password").onclick = async () => {
    const email = $("#account-email").value;
    if (!email) {
      message("Enter your email address first.");
      return;
    }
    try {
      await sdk.sendPasswordResetEmail(auth, email);
      message(
        "If that email has an account, a reset link will arrive shortly.",
      );
    } catch (e) {
      message(
        e.code === "auth/user-not-found"
          ? "If that email has an account, a reset link will arrive shortly."
          : errorText(e),
      );
    }
  };
}
async function signedIn(after) {
  await auth.currentUser.reload();
  await auth.currentUser.getIdToken(true);
  if (!auth.currentUser.emailVerified) {
    modal(
      `<h2>Check your email.</h2><p>Verify the link sent to ${esc(auth.currentUser.email)} before saving tests.</p><p id="account-message" role="status"></p><div class="actions"><button class="btn" id="check-verified">I’ve verified my email</button><button class="text-btn" id="resend-verified">Resend email</button><button class="text-btn" id="switch-account">Sign out</button><button class="btn secondary" id="modal-close">Keep studying</button></div>`,
    );
    $("#check-verified").onclick = () =>
      signedIn(after).catch((e) => message(errorText(e)));
    $("#resend-verified").onclick = async () => {
      try {
        await sdk.sendEmailVerification(auth.currentUser);
        message("Verification email sent.");
      } catch (e) {
        message(errorText(e));
      }
    };
    $("#switch-account").onclick = async () => {
      await sdk.signOut(auth);
      loginForm(after);
    };
    return;
  }
  await api("/me", "POST", { consent: true });
  profile = await api("/me");
  $("#account-link").textContent = "My dashboard";
  if (after) {
    $("#modal").close();
    after();
  } else dashboard();
}
export function savePrompt() {
  if (!bridge.getState().questions.length)
    return bridge.toast("Start a worksheet first.");
  if (!auth?.currentUser?.emailVerified) {
    openAccount(savePrompt);
    return;
  }
  const state = bridge.getState();
  modal(
    `<h2>Save this ${state.finished ? "result" : "test"}.</h2><p>This stores the questions, answers and current progress in your private account. Your original PDF stays on your device.</p><label class="field">Topic<input id="save-topic" maxlength="60" value="${esc(state.topic || "")}" placeholder="e.g. Biology"></label><p class="tiny">${state.practice ? "This is a practice attempt; it will not change your initial score." : "Your first completed score is locked. Retakes are practice only."}</p><p id="account-message" role="status"></p><div class="actions"><button class="btn secondary" id="modal-close">Cancel</button><button class="btn" id="cloud-save">Save to my account</button></div>`,
  );
  $("#cloud-save").onclick = async () => {
    const b = $("#cloud-save");
    b.disabled = true;
    try {
      if (state.cloudOwner && state.cloudOwner !== auth.currentUser.uid) {
        state.cloudId = null;
        state.cloudSavedFinished = false;
      }
      state.cloudId ||= crypto.randomUUID();
      state.topic = $("#save-topic").value;
      state.cloudOwner = auth.currentUser.uid;
      if (!state.cloudSavedFinished) {
        const saved = await api("/tests/" + state.cloudId, "PUT", {
          state,
          topic: state.topic,
        });
        state.practice = !!saved.practice;
        state.cloudSavedFinished = state.finished;
        bridge.persist();
      }
      $("#modal").close();
      bridge.toast("Saved to your account.");
    } catch (e) {
      message(errorText(e));
      b.disabled = false;
    }
  };
}
function chart(points) {
  if (!points.length)
    return '<p class="empty-note">Finish and save your first test to start your graph.</p>';
  const shown = points.slice(-20),
    width = 640,
    height = 180;
  const coords = shown.map((t, i) => [
    40 + (shown.length === 1 ? 280 : (i * 560) / (shown.length - 1)),
    160 - (140 * t.correct) / t.graded,
  ]);
  return `<svg viewBox="0 0 ${width} ${height}" class="score-chart" role="img" aria-label="First-attempt scores for your most recent ${shown.length} graded tests, oldest to newest"><line x1="40" y1="20" x2="600" y2="20"/><line x1="40" y1="90" x2="600" y2="90"/><line x1="40" y1="160" x2="600" y2="160"/><text x="0" y="25">100</text><text x="8" y="95">50</text><text x="16" y="165">0</text><polyline points="${coords.map((p) => p.join(",")).join(" ")}"/>${coords.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="4"><title>${esc(shown[i].title)}: ${percent((100 * shown[i].correct) / shown[i].graded)} · ${date(shown[i].created_at)}</title></circle>`).join("")}</svg><p class="tiny">Oldest → newest · last ${shown.length} graded initial attempts</p>`;
}
async function dashboard() {
  $("#modal").close();
  bridge.enterDashboard();
  $("#app").innerHTML =
    '<div class="workspace"><h1>Your progress.</h1><p>Loading your saved tests…</p></div>';
  try {
    const [me, tests] = await Promise.all([api("/me"), api("/tests")]);
    profile = me;
    const s = progressStats(tests);
    if (bridge.getState().view !== "dashboard") return;
    $("#app").innerHTML =
      `<section class="workspace account-page"><div class="page-heading"><div><h1>Your progress.</h1><p>${esc(me.email)}</p></div><button class="text-btn" id="account-back">Back to studying</button></div><div class="stat-row"><div><strong>${s.completed}</strong><span>Initial tests</span></div><div><strong>${percent(s.average)}</strong><span>Average initial score</span></div><div><strong>${percent(s.best)}</strong><span>Best initial score</span></div><div><strong>${s.practice}</strong><span>Practice retakes</span></div></div><section class="dashboard-section"><h2>First-attempt progress.</h2>${chart(s.points)}<p class="tiny">Average of graded initial-test percentages. Ungraded tests and retakes are excluded.</p></section><section class="dashboard-section"><h2>Favourite topics.</h2><div class="topic-list">${me.favourites.length ? me.favourites.map((t) => `<span>${esc(t)}</span>`).join("") : "<p>Choose the subjects you like studying.</p>"}</div><form id="topics-form"><label class="field">Topics, separated by commas<input id="favourite-topics" maxlength="1200" value="${esc(me.favourites.join(", "))}" placeholder="Biology, Chemistry"></label><button class="btn secondary small">Save topics</button></form></section><section class="dashboard-section"><h2>Saved tests.</h2>${tests.length ? tests.map((t) => `<article class="saved-test"><div><h3>${esc(t.title)}</h3><p class="tiny">${esc(t.topic)} · ${t.practice ? "Practice" : "Initial attempt"} · ${t.finished ? (t.graded ? percent((t.correct / t.graded) * 100) : "Ungraded") : "In progress"} · ${date(t.updated_at)}</p></div><div class="actions"><button class="btn secondary small" data-open-test="${esc(t.id)}">${t.finished ? "Review" : "Resume"}</button><button class="text-btn tiny" data-delete-test="${esc(t.id)}">Delete</button></div></article>`).join("") : "<p>No saved tests yet. Use “Save progress” during a quiz or “Save result” afterwards.</p>"}</section><div class="actions"><button class="btn secondary small" id="export-account">Export my data</button>${me.admin ? '<button class="btn secondary small" id="admin-open">Admin overview</button>' : ""}<button class="text-btn" id="logout">Sign out</button><button class="text-btn tiny" id="delete-account">Delete my account</button></div><p id="dashboard-message" role="status"></p></section>`;
    const report = (e) => ($("#dashboard-message").textContent = errorText(e));
    $("#account-back").onclick = bridge.back;
    $("#topics-form").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api("/me", "PUT", {
          favourites: $("#favourite-topics")
            .value.split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        });
        await dashboard();
      } catch (e) {
        report(e);
      }
    };
    document.querySelectorAll("[data-open-test]").forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            const t = await api("/tests/" + b.dataset.openTest);
            bridge.restore({
              ...t.state,
              cloudId: t.id,
              topic: t.topic,
              cloudOwner: auth.currentUser.uid,
              cloudSavedFinished: t.state.finished,
            });
          } catch (e) {
            report(e);
          }
        }),
    );
    document
      .querySelectorAll("[data-delete-test]")
      .forEach(
        (b) => (b.onclick = () => confirmDeleteTest(b.dataset.deleteTest)),
      );
    $("#export-account").onclick = async () => {
      try {
        downloadJSON(await api("/export"), "honey-scholar-data.json");
      } catch (e) {
        report(e);
      }
    };
    $("#logout").onclick = async () => {
      await sdk.signOut(auth);
      profile = null;
      $("#account-link").textContent = "My progress";
      bridge.logout();
    };
    $("#delete-account").onclick = deleteAccount;
    $("#admin-open")?.addEventListener("click", () => admin());
  } catch (e) {
    $("#app").innerHTML =
      `<section class="workspace"><h1>Your progress.</h1><p>${esc(errorText(e))}</p><button id="dashboard-retry" class="btn">Try again</button><button id="account-back" class="text-btn">Back to studying</button></section>`;
    $("#dashboard-retry").onclick = () => openAccount();
    $("#account-back").onclick = bridge.back;
  }
}
function downloadJSON(data, name) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function confirmDeleteTest(id) {
  modal(
    '<h2>Delete this saved test?</h2><p>This removes it from your account and progress graph. This cannot be undone.</p><p id="account-message" role="status"></p><div class="actions"><button class="btn secondary" id="modal-close">Cancel</button><button class="btn" id="confirm-delete-test">Delete test</button></div>',
  );
  $("#confirm-delete-test").onclick = async () => {
    try {
      await api("/tests/" + id, "DELETE");
      dashboard();
    } catch (e) {
      message(errorText(e));
    }
  };
}
function deleteAccount() {
  modal(
    '<h2>Delete your account?</h2><p>This permanently removes your sign-in account, saved tests, scores and topics. Export your data first if you want a copy.</p><label class="field">Type DELETE to confirm<input id="delete-confirm" autocomplete="off"></label><p id="account-message" role="status"></p><div class="actions"><button class="btn secondary" id="modal-close">Cancel</button><button class="btn" id="confirm-delete-account">Delete my account</button></div>',
  );
  $("#confirm-delete-account").onclick = async () => {
    try {
      if ($("#delete-confirm").value !== "DELETE")
        throw Error("Type DELETE to confirm.");
      await api("/account", "DELETE", { confirm: "DELETE" });
      await sdk.signOut(auth);
      profile = null;
      $("#modal").close();
      bridge.logout();
      $("#account-link").textContent = "My progress";
      bridge.toast("Your account and saved data were deleted.");
    } catch (e) {
      message(errorText(e));
    }
  };
}
async function admin(offset = 0) {
  try {
    const data = await api("/admin?offset=" + offset);
    $("#app").innerHTML =
      `<section class="workspace account-page"><div class="page-heading"><div><h1>Admin overview.</h1><p>Only the information needed to run Honey Scholar.</p></div><button class="text-btn" id="admin-back">My dashboard</button></div><div class="stat-row"><div><strong>${data.totals.accounts}</strong><span>Accounts</span></div><div><strong>${data.totals.active || 0}</strong><span>Active in 30 days</span></div><div><strong>${data.totals.saved}</strong><span>Saved attempts</span></div><div><strong>${data.totals.completed || 0}</strong><span>Completed initial tests</span></div></div><h2>Accounts.</h2><p class="tiny">Emails are for account support. Private test content, topics and individual scores are not included.</p><div class="table-scroll"><table><thead><tr><th>Email</th><th>Joined</th><th>Last account activity</th></tr></thead><tbody>${data.members.map((m) => `<tr><td>${esc(m.email)}</td><td>${date(m.created_at)}</td><td>${date(m.last_seen)}</td></tr>`).join("")}</tbody></table></div><div class="actions"><button id="admin-prev" class="btn secondary small" ${offset ? "" : "disabled"}>Previous</button><button id="admin-next" class="btn secondary small" ${offset + 50 >= data.totals.accounts ? "disabled" : ""}>Next</button></div></section>`;
    $("#admin-back").onclick = dashboard;
    $("#admin-prev").onclick = () => admin(Math.max(0, offset - 50));
    $("#admin-next").onclick = () => admin(offset + 50);
  } catch (e) {
    bridge.toast(errorText(e));
  }
}
