# Doctor Nath

**A project-based innovation platform for young Rwandan adults (20-38).** Learners solve staged challenges built on real community and employer problems, volunteer mentors review their work, and completed projects become a portfolio of badges that anyone can verify.

| | |
| --- | --- |
| Live app | <https://doctor-nath.onrender.com> (free hosting: the first visit after a quiet period takes about a minute to wake up) |
| SRS document | _add your SRS link here_ |
| Demo video | _add your video link here_ |
| Author | Muhirwa Nathan, African Leadership University |

## The problem

Young Rwandans face a harder transition to work than adults: youth unemployment was 14.7% against 10.8% for adults in 2025, and youth labour underutilisation stood at 56.7% (NISR Labour Force Survey 2025). Employers report soft-skill and ICT skill gaps, and only 1,850 of 4,535 graduates seeking hands-on attachments were placed. Young adults have no accessible, continuous way to practise applied problem-solving, and no verifiable proof of the skills they do build.

## The solution

| User | What they can do |
| --- | --- |
| Learner | Register, take the pre-programme survey, browse and filter challenges, enrol, work through stages (offline too), submit text/links/files, revise after feedback, earn signed badges, share a public portfolio, take the post-programme survey |
| Mentor | Get submissions matched to them automatically, see a deadline countdown, compare a resubmission with the previous version, give rubric feedback and a 1-5 rating (optionally drafted by AI), approve or request changes |
| Admin | Track the pilot hypotheses on a live dashboard, create/edit/publish/archive challenges, manage roles and mentor capacity, check the tamper-evident audit log, export survey results as CSV |
| Employer / public | Open a learner's shared portfolio and verify any badge by QR code, without an account |

---

## Run it on your computer

### 1. Install the prerequisites

1. **Node.js 22.13 or newer** (24 LTS recommended): download from <https://nodejs.org> and install with the default options. The app uses Node's built-in SQLite database, so no separate database is needed.
2. **Git**: <https://git-scm.com/downloads>.
3. Check both in a terminal:
   ```bash
   node --version    # must print v22.13.0 or higher
   git --version
   ```

> **Windows PowerShell users:** if `npm` fails with *"running scripts is disabled on this system"*, type `npm.cmd` instead of `npm` in every command below, or run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

### 2. Download the code

```bash
git clone https://github.com/muhirwanathan/DOCTOR-Nath.git
cd DOCTOR-Nath
```

### 3. Install dependencies

```bash
npm install
```
This installs both the server (`server/`) and the web app (`web/`) in one go. It takes 1-2 minutes; warnings about "install-scripts" can be ignored.

### 4. Load the demo data

```bash
npm run seed
```
This creates `server/data/dr-nath.db` with about six weeks of pilot history: 14 learners, 4 mentors, 6 challenges, submissions, feedback, signed badges and surveys. Run it again at any time to reset everything.

### 5. Start the app

```bash
npm run dev
```
This starts the API on port 4000 and the web app on port 5173. Keep this terminal open; press `Ctrl+C` to stop.

### 6. Open it

Go to **<http://localhost:5173>** and log in. Every demo account uses the password **`password123`**:

| Role | Email | Try this |
| --- | --- | --- |
| Learner | `aline@example.rw` | Home recommendations, portfolio with 5 signed badges and QR codes |
| Learner | `sandrine@example.rw` | Mid-challenge: open a stage, write a draft, submit (works offline too) |
| Mentor | `grace@drnath.rw` | Review queue with deadlines, countdown, rubric feedback |
| Mentor | `eric@drnath.rw` | A "harsh" mentor in the rating-calibration table |
| Admin | `admin@drnath.rw` | Pilot impact dashboard, challenge editing, users, audit log |

New accounts can be created from the sign-in page (learner or mentor).

### 7. Optional settings

Copy `server/.env.example` to `server/.env` and fill in what you need:

| Variable | What it does |
| --- | --- |
| `ANTHROPIC_API_KEY` | Turns on "Draft with AI" for mentors (uses Claude). Without it, mentors write feedback by hand. |
| `SENDGRID_API_KEY` | Sends real emails. Without it, emails are printed in the server terminal. |
| `AFRICAS_TALKING_API_KEY`, `AFRICAS_TALKING_USERNAME` | Sends real SMS. Without them, SMS are printed in the server terminal. |
| `JWT_SECRET` | Required in production; any long random string. |

### 8. Run the tests

```bash
npm test
```
Runs 46 tests: unit tests for every core algorithm (99% line coverage of `server/src/lib`) and an end-to-end API test of the whole learner-mentor-admin flow. Tests never call the real Claude API.

### 9. Production build (one process, one port)

```bash
npm run build
npm start
```
Open <http://localhost:4000>. The API also serves the built web app.

---

## Deploy it (public URL)

The repo includes a Render blueprint (`render.yaml`):

1. Sign in at <https://render.com> with your GitHub account.
2. Click **New** → **Blueprint** and choose this repository.
3. Click **Apply**. Render installs, builds and starts the app (about 5 minutes) and gives you a URL like `https://doctor-nath.onrender.com`.
4. Optional: in the service's **Environment** tab, add `ANTHROPIC_API_KEY`.

On the free plan the service sleeps after 15 minutes without visitors (the first visit then takes about a minute to wake it), and its disk is reset on each restart. The app reloads the demo data automatically whenever it starts with an empty database, so the demo accounts above always work.

---

## How the SRS maps to the code

| Requirement | Where it is |
| --- | --- |
| FR1 accounts, roles, password reset, language | `server/src/routes/auth.ts`, `web/src/pages/Auth.tsx`, `web/src/i18n.tsx` |
| FR2 challenge library, search, theme filter | `server/src/routes/challenges.ts`, `web/src/pages/Learner.tsx` |
| FR3 enrolment, stages unlock in order | `routes/challenges.ts`, `services/progress.ts` |
| FR4 submissions (10 MB files), offline drafts | `routes/work.ts`, `web/src/offline/` |
| FR5 mentor queue, rubric feedback, resubmission | `routes/mentor.ts`, `services/assign.ts`, `web/src/pages/Mentor.tsx` |
| FR6 progress tracking | `services/progress.ts` |
| FR7 badges | `services/progress.ts`, `lib/credentials.ts` |
| FR8 shareable portfolio | `routes/learner.ts`, `web/src/pages/Portfolio.tsx` |
| FR9 admin: challenges (create, edit, archive), users and roles | `routes/challenges.ts`, `routes/admin.ts`, `web/src/pages/Admin.tsx` |
| FR10 notifications (in-app, email, SMS) | `services/notify.ts` |
| FR11 pre/post surveys, CSV export | `routes/learner.ts`, `routes/admin.ts` |
| NFR3 hashed passwords, HTTPS-ready, login lockout | `lib/password.ts`, `routes/auth.ts` |
| NFR4 delete account and data | `DELETE /api/me` in `routes/auth.ts` |
| NFR8 English and Kinyarwanda | `web/src/i18n.tsx` |
| NFR9 tested core modules | `server/test/` |

### Beyond the SRS baseline

| Feature | What it does | Code |
| --- | --- | --- |
| Smart mentor matching | Scores mentors on expertise, spare capacity, turnaround, language and continuity; explains each choice | `server/src/lib/matching.ts` |
| Deadline monitor | Warns mentors when a review is due soon; reassigns it to another mentor if the 5-day target is missed | `services/assign.ts` |
| Recommendations | Suggests the next challenge from a skill model of mentor-approved work, one level up, respecting prerequisites | `lib/recommend.ts` |
| Rating calibration | Corrects for harsh or generous mentors (empirical Bayes) | `lib/calibration.ts` |
| Verifiable badges | W3C Verifiable Credentials (Open Badges 3.0) signed with Ed25519; public key at `/.well-known/did.json` | `lib/credentials.ts` |
| Tamper-evident audit log | SHA-256 hash chain; the admin page shows exactly where a record was altered | `lib/hashchain.ts` |
| Offline-first | Service worker, drafts saved on the device, queued submissions sent exactly once, 3-way merge when two devices edit the same draft | `web/src/offline/`, `lib/merge.ts` |
| Impact analytics | Tests the proposal's hypotheses live: confidence intervals against the 60%/70% targets, paired t-test with effect size | `lib/stats.ts`, `services/analytics.ts` |
| AI feedback drafts | Claude drafts rubric feedback for the mentor to edit; marked as AI-assisted | `services/ai.ts` |

## Project structure

```
DOCTOR-Nath/
├── server/            Fastify API (TypeScript)
│   ├── src/lib/       pure algorithms: matching, recommendations, stats, credentials, hash chain, merge
│   ├── src/services/  assignment and deadlines, notifications, progress and badges, analytics, AI
│   ├── src/routes/    REST endpoints per feature
│   ├── src/seed.ts    demo data
│   └── test/          unit and API tests
├── web/               React web app (works offline, installable on phones)
│   ├── src/pages/     screens for learners, mentors, admins and public pages
│   ├── src/offline/   outbox and draft sync
│   └── public/sw.js   service worker
└── render.yaml        deployment blueprint
```

## Tech stack

Node.js 24, TypeScript, Fastify, SQLite (`node:sqlite`; the schema is standard SQL for a later move to PostgreSQL), React 19, Vite, IndexedDB, Vitest, Anthropic Claude API.

## Known limitations

- The Kinyarwanda interface text is a first draft and needs review by a native speaker.
- On the free hosting plan, data entered by visitors is reset when the service restarts.
- SQLite suits the 100-user pilot; PostgreSQL is planned for scale (SRS 2.4).
