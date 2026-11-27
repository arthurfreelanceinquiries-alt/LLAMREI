# Ascension progress

Baseline source: `7797785`. Work starts from `develop/llamrei-4` at `01c1263` on `ascension/phase-00-01`.

- [x] Phase 00 baseline audit and build/test evidence.
- [ ] Phase 01 centralized authority, privacy and execution reliability.
- [ ] Phase 02 design tokens and accessible UI primitives.
- [ ] Phase 03 workspace redesign.
- [ ] Phases 04–11 per master plan.

## Phase 00

The commit titled `docs(ascension): record Phase 00 baseline validation` records the [FR-01–81 and Phase 5 inventory](ASCENSION_BASELINE.md), test coverage, and open integration questions. Node 24.22.3 completed frozen installation, type checking, the production build and 21 tests. Local UI and API started against a disposable SQLite database. An online backup restored task rows and passed SQLite integrity and foreign-key checks. Chromium verified the rendered Overview and Tasks using anonymous fixtures at 360, 768 and 1440 px. Fix mobile layout and palette Escape after the Phase 01 gate.

Real accounts, devices, Tailscale infrastructure, Tauri packaging and Android exact alarms were outside baseline validation. Phase 01 starts with server authority, exact approval binding and honest execution outcomes.

## Phase 01 batch 1 — fallback vault

The commit titled `fix(security): protect the fallback secrets vault` adds a random owner-only key, authenticated encryption, atomic rotation of legacy ciphertext on access, and serialization across processes. Three isolated vault tests passed. They cover legacy decryption and migration, restoration using the ciphertext and key on a disposable copy, and concurrent writers. Missing or corrupt keys leave the existing ciphertext intact. Back up both the key and ciphertext. The original host and user are needed to unlock a legacy vault before its first upgrade. Live libsecret and Windows ACLs remain unverified.

## Phase 01 batch 2 — proxy and browser authentication

The commit titled `fix(auth): require credentials for forwarded API requests` retains localhost and Vite access, plus bearer-authenticated API clients. Private Tailscale Serve can use the opt-in browser session described in the README. The session requires a configured HTTPS origin, uses a Secure HttpOnly cookie, checks origin for writes, expires after one hour, and revokes active SSE streams on sign-out. Seven focused auth and Phase 2 tests passed. A synthetic trusted TLS proxy verified sign-in, API access, and revocation, and Chromium rendered the sign-in flow through a test relay that retained upstream TLS verification. Live Tailscale and Android sessions remain unverified.

## Phase 01 batch 3 — scheduler and device outcomes

The commit titled `fix(runtime): persist message claims and report device outcomes` prevents overlapping scheduler ticks and claims rows conditionally in SQLite before dispatch. Interrupted or ambiguous attempts are recorded for reconciliation without automatic resend. Gateway success requires a delivery response. A WhatsApp webhook must return HTTP 2xx with `{"delivered":true}` to mark a message sent. The scheduler and device suites verified database concurrency, recovery, gateway outcomes, and transport acknowledgement through four focused tests. The Phone Hub keeps local preferences available and shows pending, offline and failed device outcomes without inventing attachments or device state. Chromium verified offline and pending feedback and both DND command directions using mock responses. Real delivery and device acknowledgement remain unverified.

## Phase 01 batch 4 — approvals, privacy, and cost controls

The commit titled `fix(agent): bind tool approvals and enforce private routing` applies one server-side Composio policy to the direct API and agent. Reads require an explicit read policy, discovery, an enabled toolkit, one active account, and valid arguments. Other discovered actions require a one-time 15-minute approval bound to the displayed account and arguments. Changed arguments or accounts, expired approvals, unknown tools, repeated approval, unconfirmed execution, and provider failures were covered using fixtures. Local agent actions apply the stored proposal, require approval for device commands, and provide compensation where the previous local state can be restored. External execution and legacy actions without a reliable record do not offer Undo.

Private conversation context uses loopback Ollama or local rules by default. Cloud processing requires separate consent from the billing preference. WhatsApp imports classify locally. Free-only AI fails closed on unverified prices. Reported cost is recorded separately from older estimates. Transactional migration 007 applied once on a disposable copy restored from the baseline. Historic ledger and task records survived two restarts and passed integrity and foreign-key checks.

Verification for the combined Phase 01 tree: frozen installation of 190 packages, `npm run typecheck`, `npm run build`, and `LLAMREI_DB_PATH=:memory: npm test` with 38 passed, zero failed or skipped. `npm audit --omit=dev` reported zero vulnerabilities. Chromium exercised pending, rejected, unknown, and confirmed approval states through the current API on disposable SQLite with simulated Composio responses. It also verified a task filter and the absence of Undo on external actions.

### Phase 01 gate remains open

The live OpenCode and OpenRouter pricing catalogs returned HTTP 403 in this cloud. Cloud pricing validation used fixtures. Paid execution remains gated until verified pricing and pre-dispatch reservation can be validated. Composio, Tailscale and NectarLink integration tests used fixtures. Live accounts, actual delivery, and hardware acknowledgement are outstanding. Review remaining identity defaults in legacy demo seeds, WhatsApp alias defaults, and repository history separately. Phase 02 and Phase 03 remain pending behind the Phase 01 gate.
