# Honey Scholar

[Try the website](https://honeyscholar.pages.dev/)

A worksheet practice app by me :), a first-year University of Birmingham student. Upload a text-based PDF, check its extracted questions and practise one question at a time.

## Features

- Multiple-choice and fill-in-the-blank questions.
- Embedded, separate or manually entered answer keys.
- One-question and all-question views, with an optional timer.
- Locked submitted answers and a preserved initial score; retakes count as practice.
- Optional Google or email/password sign-in to save selected tests.
- A dashboard with first-attempt progress, favourite topics and average scores.
- Account export and deletion, plus a limited admin overview.
- An optional external AI prompt helper. It does not make paid AI API calls.

## Run locally

Use Node.js 24 and Python 3:

```sh
npm ci
python3 -m http.server 4173 --directory dist
```

Open http://localhost:4173. Worksheet practice runs entirely in the browser. The static preview does not include account APIs; those require the Cloudflare setup below.

```sh
npm test
npm run format:check
```

The tests cover worksheet extraction, grading, initial-score statistics, account isolation, admin restrictions, exports and account deletion. Authentication is mocked in automated tests.

## Project structure

| Path | Purpose |
| --- | --- |
| `dist/app.mjs` | Worksheet editor, quiz and review screens |
| `dist/engine.mjs` | Parsing and grading |
| `dist/accounts.mjs` | Optional sign-in and dashboards |
| `dist/account-stats.mjs` | Progress calculations |
| `server/worker.mjs` | Authenticated account and saved-test API |
| `migrations/` | D1 database schema |
| `tests/` | Node test suite |
| `scripts/package-cloudflare.mjs` | Cloudflare Worker packaging |

`dist/` contains the authored browser source, despite its name. The Worker bundle `dist/_worker.js` is generated and is not committed.

## Optional accounts and deployment

1. Create a Firebase project. Enable Google and email/password sign-in and authorise your deployment domain. The app requires verified email addresses before saving tests. Enforce a minimum password length of 12 characters for email signup.
2. Create a Cloudflare D1 database and apply `migrations/0001_accounts.sql`. Bind it to the Pages project as `DB`.
3. Configure these Pages environment variables:

   - `FIREBASE_API_KEY`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_AUTH_DOMAIN`
   - `FIREBASE_APP_ID`
   - `ADMIN_EMAIL` — the verified email allowed to use the admin overview

4. Run `npm run package:cloudflare` and deploy the contents of `dist/` to Cloudflare Pages. Include `_worker.js` and `_routes.json`.
5. If deploying your own copy, update the canonical URL, social URL, sitemap and robots.txt to your domain.

This source copy leaves deployment configuration empty. It contains no user database, passwords or private keys. The production website is configured separately.

## Data and scoring

Original PDFs are processed on the device. Only tests a signed-in user chooses to save are uploaded. The admin screen shows account emails, account dates and aggregate counts, not individual test content or scores. The infrastructure owner can technically access stored data; the website explains this in its Privacy notice.

Saved submitted answers and completed results are locked. Repeated question sets are treated as practice and excluded from the initial-score average. This is a personal study tool, not a proctored assessment: users control their worksheets and can delete saved records.

## Limitations

The moon.

## Third-party assets

PDF.js 4.10.38 is distributed under Apache-2.0; its licence is included in `dist/vendor/LICENSE`. Third-party characters and artwork are not claimed as original work or covered by a new licence in this repository.
