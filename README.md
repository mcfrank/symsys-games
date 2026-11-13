# SymSys games

*Built with Claude Opus 5.5.*

A live, paired game-theory demo for SYMSYS 1 ("Minds and Machines", Stanford). Students join from a QR code on their phones, get an anonymous pseudonym, and play four one-shot games with a new random partner each time. The instructor's dashboard keeps class results hidden until Reveal, then shows them next to the Nash prediction, published reference values, and the choices of two Gemini models.

Live at https://symsys-games-246740721864.us-west2.run.app (dashboard at `/dashboard`).

## The games

| Game | Decision | Payoffs | Nash |
|---|---|---|---|
| Clean up or pollute? (prisoner's dilemma) | both choose at once | clean/clean −2/−2, clean/pollute −10/0, pollute/clean 0/−10, pollute/pollute −8/−8 | both pollute |
| Ultimatum | proposer offers 0–10; responder first states the lowest offer they'd accept, then accepts or rejects the real offer | accept: (10 − offer, offer); reject: (0, 0) | offer 1, accept any positive offer |
| Dictator | everyone gives 0–10 to a random classmate (a random cycle, so everyone gives once and receives once) | (10 − gift, gift) | give 0 |
| Where do you meet? (coordination) | pick one of 7 campus spots, shown in random order on each phone | +5 each if matched, else 0 | any match (no unique equilibrium) |

Payoffs are tested against these tables in `backend/test/games.test.js`.

## Design decisions

- **Odd class size:** one student is paired with a bot, with bot moves from the handoff (PD: 50/50; offers 4 and accepts ≥3; gives 2; picks Main Quad).
- **Timeouts:** each decision has 45 seconds; after that a bot move fills in and is flagged. The responder's clock starts once the offer has arrived and they've answered the "lowest offer" question.
- **What counts in the class statistics:** every decision a human actually made counts, even if their partner was a bot or timed out. Pair-level results use only pairs of two humans where nobody timed out: the PD outcome grid and average points, acceptance by offer amount, and the coordination match rate.
- **No anchoring defaults:** amounts are picked from a 0–10 grid with nothing preselected, and paired choice buttons look identical.
- **Gemini participants:** `gemini-2.5-flash` and `gemini-3.8-flash` each answer every prompt 10 times, using the same text students see (`backend/gemini.js`). Runs happen at server start and are cached in Firestore; "Re-run Gemini" on the dashboard refreshes them. No sampling parameters are set (Google ignores them on current models).
- **Anonymity:** a random id in the phone's localStorage plus a generated pseudonym. No names, emails or logins for students.

## Architecture

A single Node process (Express + Socket.io) on Cloud Run owns the class state: pairing, payoffs, timeouts. Students' phones only send their own moves. State is snapshotted to Firestore (`games_sessions`, `games_settings`, `games_gemini` in hs-hs-langcog-gemini's default database) so a restart mid-class resumes where it left off. The dashboard signs in with Google; only emails in `ADMIN_EMAILS` get the controls, results and CSV export.

## Running a class

1. Open `/dashboard` and sign in. Click **New session** *before* showing the QR code (it gives everyone new pseudonyms).
2. Students scan the QR code. When the join count looks right, click **Start**.
3. Watch "decided" climb; click **Reveal** (it closes the game first, filling any missing decisions with flagged bot moves), discuss, then **Start** the next game.
4. **Download CSV** at the end: one row per student per game, plus Gemini's answers. Ids are random; pseudonyms are generated.

After the class week, scale the always-on instance down: `MIN_INSTANCES=0 ./deploy.sh`.

## Development

```
cd backend && npm install && npm test
cd frontend && npm install && npm test && npm run build
```

Run locally against separate Firestore collections, with a dev login for the load test:

```
cd backend && COLLECTION_PREFIX=games_dev DEV_ADMIN_TOKEN=dev-token GOOGLE_GENAI_USE_VERTEXAI=true \
  GOOGLE_CLOUD_PROJECT=hs-hs-langcog-gemini GOOGLE_CLOUD_LOCATION=global PORT=8090 node server.js
```

Copy `frontend/dist` to `backend/public` to serve the UI, or run `BACKEND_URL=http://localhost:8090 npm run dev` in `frontend/`. The dashboard accepts the dev token if you put it in sessionStorage as `symsys-games-admin-token`.

**Load test:** `DEV_ADMIN_TOKEN=dev-token node backend/scripts/loadtest.js http://localhost:8090 201` simulates a class (random timing, non-responders, refreshes, late joiners), drives the instructor controls, and checks every payoff. Use `DECISION_SECONDS=10` on the server to make it quick.

## Deploying

`./deploy.sh` (needs `gcloud auth login` as a project member). One-time setup, already done: service account `symsys-games-run` with `roles/aiplatform.user` and `roles/datastore.user`; Artifact Registry repo `symsys-games` (us-central1); the service URL added to the OAuth client's authorized JavaScript origins. The service runs in us-west2, alongside the Turing test.
