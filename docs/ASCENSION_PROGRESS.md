# Ascension progress

Baseline source: `7797785`. Work starts from `develop/llamrei-4` at `01c1263` on `ascension/phase-00-01`.

- [x] Phase 00 baseline audit and build/test evidence.
- [ ] Phase 01 centralized authority, privacy and execution reliability.
- [ ] Phase 02 design tokens and accessible UI primitives.
- [x] Phase 03 workspace redesign and local acceptance checks.
- [x] Phase 04 Cognitive Core and local acceptance checks.
- [ ] Phase 05 Knowledge Vault and personal memory.
- [ ] Phases 06–11 per master plan.

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

The live OpenCode and OpenRouter pricing catalogs returned HTTP 403 in this cloud. Cloud pricing validation used fixtures. Paid execution remains gated until verified pricing and pre-dispatch reservation can be validated. Composio, Tailscale and NectarLink integration tests used fixtures. Live accounts, actual delivery, and hardware acknowledgement are outstanding. Review remaining identity defaults in legacy demo seeds, WhatsApp alias defaults, and repository history separately.

## Phase 02 — Obsidian foundation and responsive workspace

The commit titled `feat(ui): ship the Obsidian workspace foundation` adds semantic dark and light themes, focus and motion tokens, reusable controls and modal panels, a collapsible desktop sidebar, compact navigation, and a full-screen JARVIS panel. Previously saved themes remain selectable. The command palette supports grouped results, keyboard selection, Escape and focus restoration. The overview prioritizes task and agenda data and shows an unavailable state for a missing TradingView chart. Task views retain the list, Kanban, calendar and timeline, surface custom statuses, keep titles readable at mobile widths, and expose keyboard view and status controls. These UI changes build on the Phase 01 feature branch while its live integration checks remain open.

Node 24 completed a fresh lockfile installation (191 packages), typecheck, a production build and 38 tests with no failures or skips. The production dependency audit reported zero vulnerabilities. Lucide React 0.577.0 is ISC-licensed and declares React 19 support. The full UI JavaScript build measured 128.07 kB gzipped, up from 120.64 kB for Phase 01.

Chromium exercised anonymous fixtures at 360, 768 and 1440 px. Verified navigation and collapse, 44 px primary navigation targets, keyboard palette selection into task detail, Escape and focus restoration, JARVIS shortcut, task title filtering and keyboard tabs, and reload from a simulated bootstrap failure. The title area at 360 px measured 302 px. The screenshots showed no horizontal document overflow. Scoped axe checks returned zero automated violations for the palette and inspected desktop screens. The tested text token pairs measured 6.51:1 or higher in both themes. Full manual contrast review, migration of legacy UI primitives, and performance checks on target hardware are outstanding.

The Phase 03 batches below record the wider redesign and functional acceptance on disposable local data. Live Phase 01 delivery, device acknowledgement and paid AI reservations remain open.

## Phase 03 batch 1 — schedule and alarm integrity

Commit `6831243` (`fix(calendar): preserve durations and linked alarm state`) keeps durations during a calendar move, updates linked alarms and task projections together, and preserves a task deadline when moving its independent focus block. Metadata edits preserve snoozed or dismissed alarms. Due alarms compare instants across timezone offsets and are claimed before delivery work. Schedule previews account for events crossing midnight in WIB. Interactive schedule application can reject a preview that changed before confirmation. Unscheduled tasks stay outside the timeline.

The full server suite passed 43 tests, including five calendar regression cases on disposable SQLite. No schema migration was needed. Browser acceptance for the redesigned screens is tracked in the next batch.

## Phase 03 batch 2 — Obsidian workspace workflows

The commit titled `feat(workspace): deliver Phase 03 Obsidian workflows` links the overview to actual tasks, upcoming agendas, alarms and approval states. The task workspace shares status and priority filters across list, Kanban, calendar and timeline, and saves view and density preferences locally. Task details use explicit saves for content and dates and report failures without clearing the form. Calendar day, week, month and agenda modes use WIB, show source and conflicts, and preview moves before writing. The alarm center supports browser ringing, one-shot tone samples, snooze, dismissal and explicit phone participation. Search opens exact workspace results. Copilot contextual actions open a draft for explicit submission, and settings group model, budget, cloud consent and connection options.

Node 24.22.3 completed `npm ci` from the lockfile, `npm run typecheck`, `npm run build` and `LLAMREI_DB_PATH=:memory: npm test` with 43 passed and zero failures or skips. The production build measured 134.37 kB gzipped JavaScript. This phase adds no dependencies or schema migrations.

Chromium with a loopback API and synthetic in-memory SQLite verified task, subtask and document CRUD, failed-create retry, saved filters, keyboard status change, Kanban drag/drop, timer, Markdown import and CSV export. It verified agenda creation, calendar drag/drop preview, conflicts, duration and linked alarm preservation, all four calendar modes, alarm creation and browser ringing, snooze, dismissal and toggle. Auto-schedule returned HTTP 409 for a stale preview without writing blocks, then applied the refreshed times. Settings theme persistence, keyboard focus and Copilot draft, failed-send retry, local approval and Undo also passed. The fixture blocked outbound requests.

Screenshots were captured in Obsidian at 360, 768 and 1440 px and in the light theme at 1440 px. The inspected layouts had no horizontal document overflow or browser errors. Scoped axe checks found zero automated violations in the calendar and command palette. Calendar contrast follow-up remains for nodes axe flagged for manual review. On this cloud host using Vite and synthetic data, cold overview loads took 423–597 ms, opening and filling the palette took 57–70 ms, and calendar navigation took 81–84 ms on desktop and 173–174 ms through the compact drawer. Performance on target hardware remains unverified.

The Phase 03 local acceptance gate passes. Real Android exact alarms, NectarLink delivery, live Notion sync and real cloud account execution remain unverified. Phase 04 covers provider routing, streaming, cost and context validation before live opt-in smoke checks.

## Phase 04 batch 1 — model routing and measurements

The commit titled `feat(ai): route verified models with streaming and latency metrics` separates OpenAI-compatible transport from eligibility, routing and measurement. OpenCode and OpenRouter require a current exact zero-price listing and skip routes reporting a charge. OpenRouter keeps zero routing ceilings. Ollama connects only to loopback and uses the native `/api/tags` list to verify the installed selection and exclude hosted aliases. Known tool and context limits influence fallback. A transient rate limit opens the circuit, two failures within a minute trigger a cooldown, and one probe can attempt recovery. Transport errors use fixed descriptions.

The adapter reads SSE deltas and assembles complete tool arguments. Incomplete responses and invalid argument objects are rejected. Authenticated `GET /api/ai/metrics` groups up to 2,048 local attempt samples over seven days and reports p50 and p95 time to first streamed text by provider and model with sample counts. Cancelled, failed, buffered JSON and tool-only responses do not contribute to text latency percentiles. The metric records provider dispatch to the first non-whitespace text delta. Dispatch samples contain timing and route metadata. Audio measurements belong in Phase 08.

Node 24.22.3 completed a clean lockfile install, typecheck and 49 server tests. Mock coverage includes UTF-8 split frames, fragmented calls, truncation, cancellation, capability fallback, circuit cooldown and reopening, hosted alias denial and zero-cost billing checks. A synthetic Phase 03 backup migrated to 008 once and preserved task rows and a legacy usage entry. Restart and restore retained timing samples and passed SQLite integrity and foreign-key checks. Live model compatibility and priced billing remain open. Streaming through the conversation and browser is tracked in the next batch.

## Phase 04 batch 2 — conversation and tool boundaries

The commit titled `feat(agent): stream bounded turns with validated tool sources` adds authenticated NDJSON at `POST /api/agent/prompt/stream`. The JSON prompt endpoint remains available. A disconnect cancels the upstream response. The user message, final answer, and any pending proposal are saved together after completion. Provider text stays provisional until completion and tool calls must match the per-turn registry and argument schema. External agent tools require cloud consent and recheck their bound account before dispatch. Writes still require approval. Unknown messaging recipients need a registered contact.

Prompt context uses the recent thread, selected attachment fields and bounded, redacted tool observations. User data remain outside the system instruction. Source labels derive from selected attachments and successful reads, with references stored alongside the final answer. Migration 009 preserved earlier thread rows and its source references survived restart and restoration of a synthetic backup.

Typecheck and 53 server tests passed. The HTTP fixture confirmed deltas arrive before persistence, a cancelled turn leaves the draft uncommitted, invalid calls create no approval, the JSON route still works, and forwarded requests share the existing auth and origin checks. Composio fixtures exercised validation both before proposal and at execution. Browser streaming, retry controls and the latency panel remain in the next batch.

## Phase 04 batch 3 — JARVIS streaming and retry

The commit titled `feat(copilot): show live answers, safe retry, and model latency` displays provisional text, tool activity, final sources, and model selection in the JARVIS drawer. Users can stop a reply and retry with their draft. The server reuses a saved answer when the same request and payload return after a connection loss. A retry with a saved approval does not create another proposal. Task and alarm proposals show a summary and the exact parameters. Settings shows text latency by model and supports refreshing measurements.

The Phase 04 branch started at `develop/llamrei-4` and fast-forwarded locally to the merged Phase 03 tree `a24cc9b`. Node 24.22.3 completed `npm ci`, typecheck, the production build and 54 server tests with zero failures or skips. Production JavaScript measured 136.39 kB gzipped. Both migrations were verified with disposable SQLite backups. A focused test replayed concurrent requests and found one stored reply and one approval.

Chromium served the production build from the actual API with synthetic SQLite data and a synthetic loopback model. It verified visible partial text, source references, keyboard cancellation, HTTP failure with draft retention, retry after a lost completion receipt, and approval and Undo for a local task. Obsidian screenshots at 360, 768 and 1440 px and light mode at 1440 px were inspected with no horizontal overflow or browser errors. Scoped axe checks found zero automated violations in the JARVIS drawer and latency panel. The fixture measured p50 at 173 ms and p95 at 184 ms from four streamed text samples. The delays came from the synthetic model server.

The Phase 04 local acceptance gate passes. Real opt-in provider smoke tests remain open. Cloud inference is limited to verified zero-cost routes, and paid dispatch remains gated. Ollama requires an installed model on a loopback daemon exposing `/api/tags`. Real model latency and audio latency have not been measured.

## Phase 05 batch 1 — Knowledge Vault storage and retrieval

The commit titled `feat(memory): persist opt-in notes and local hybrid search` adds structured notes, explicit document snapshots with provenance, revision checks and expiration. SQLite FTS5 updates with each mutation. Removing a source document or expiring a note removes it from search and clears its vector. Local embeddings are opt-in and require an installed model on the loopback Ollama daemon. If the daemon or selected model is unavailable, search uses FTS5. The hybrid search merges lexical rank with cosine-similarity rank over up to 240 active indexed notes.

The Phase 05 branch starts from the tested Phase 04 tree `524c42f`. Node 24.22.3 completed a frozen install, typecheck and 58 server tests. A disposable Phase 04 backup migrated through 010 once and preserved existing chat and task rows. SQLite integrity and foreign-key checks passed, and restart and restored backup both returned the saved note from FTS5. Synthetic Ollama responses covered hybrid recall, hosted alias denial, index opt-out and late-vector rejection after an edit. Real embedding accuracy and latency still need validation on a host with a local model.
