# Phase 00 baseline audit

The development branch started at `01c1263`, with application source from `7797785`. The feature IDs below follow the [product requirements](../DOKUMEN_INDUK_LLAMREI.md). Status reflects this baseline.

- **Integration-tested** means a named assertion exercised the relevant local path or a labeled fixture or mock. Scope limits appear in the evidence.
- **Implemented** means a substantive source path exists. The documented interaction still needs a dedicated check.
- **Prototype** means a partial path, seed data, or simulation supports the requirement.
- **Planned** means the baseline lacks a dedicated implementation for the requirement.
- **Operational** would require exercising an actual external service or device. No external workflow received that rating in this audit.

## Build, runtime, and data

| Check | Observed result |
| --- | --- |
| `npm ci` | Node 24.22.3, lockfile install completed. npm reported its install-script policy warnings for Baileys, esbuild, and protobufjs. |
| `npm run typecheck` | App and server TypeScript checks passed. |
| `npm run build` | Vite production build passed with 52 modules, 452.53 kB JavaScript and 43.79 kB CSS before compression. |
| `npm test` | 21 passed, 0 failed, 0 skipped. Six files cover core flows, phases 2–5, and Baileys. |
| Local API and Vite proxy | Fixture health returned `ok: true`. The workspace request returned populated tasks through the frontend proxy. |
| Disposable SQLite backup and restore | The Node SQLite online backup restored the task rows, including a changed fixture value. The restored copy had six recorded migrations, `integrity_check` of `ok`, and zero foreign-key violations. |
| Native and connected services | APK/AAB and Tauri packaging, paired Android behavior, live provider calls, externally delivered messages, and Tailscale connectivity were outside the executed baseline. |

The web workflow uses React 19, Vite 7, Tailwind 4, TypeScript 5.9, and Node 24 with built-in `node:sqlite`. Runtime packages beyond React include Baileys 7 release candidate, QRCode, and Pino. Baileys is a prerelease integration with separate auth state. Android's Gradle configuration uses SDK 35 and Java 17. Tauri 2 uses a separate Rust manifest. See [package manifest](../package.json), [npm lockfile](../package-lock.json), [Android manifest and build](../android-widgets/app/build.gradle.kts), and [Tauri manifest](../src-tauri/Cargo.toml).

SQLite stores tasks, linked calendars and alarms, contacts, messages, device state, journals, AI usage and audit rows, documents, and settings. Migrations 001–006 add the core schema, productivity, journal/documents, WhatsApp proposals and threads, then Composio. WAL and foreign keys are enabled on open. Migration application and its bookkeeping are separate operations at baseline, and the initializer seeds a fresh database with demo records. Preserve IDs and validate migration and restart behavior on a copied database. The online backup verified the database only. A deployment restore also needs separate coverage for vault and API token files, optional OS keyring entries, and Baileys authentication state. See [database initializer](../server/db/connection.ts), [migrations](../server/db/migrations), and [secret service](../server/services/secret.service.ts).

## FR inventory

| ID | Status | Baseline evidence and limit |
| --- | --- | --- |
| FR-01 | Prototype | Agent inserts chat messages into SQLite and publishes SSE updates. Prompt HTTP response contains a completed turn, so incremental token streaming is outstanding. |
| FR-02 | Implemented | App sends context attachments from task and news actions in the workspace and morning dashboard. The rest of the documented contextual entry points need dedicated coverage. |
| FR-03 | Integration-tested | `ai-provider.service.ts` and the Phase 5 fallback fixture exercise provider selection and the ledger. OS keyring use and complete monthly budget enforcement remain open. |
| FR-04 | Prototype | Agent can summarize an attached news item and persists its model label. Dedicated translation and consistent generated-content labels need verification. |
| FR-05 | Integration-tested | Core agent task approval and Phase 5 mocked read loop exercise natural-language tools. Device commands only have local evidence. |
| FR-06 | Integration-tested | Core approval and scheduled-message tests and Phase 5 mock exercise approved paths. Direct Composio execution and immediate device actions bypass the baseline gate. |
| FR-07 | Prototype | `agent_audit_logs` and task undo are exercised by the core test. External effects, duplicate claims, and partial compensations still require Phase 01. |
| FR-08 | Implemented | `buildMorningBriefingText` and `MorningBentoView` read agenda, tasks, alarms, Life OS, and market state. Seed data can populate a fresh view. |
| FR-09 | Implemented | Drawer and `voice.ts` wire optional speech recognition and speech synthesis. No browser permission or device audio exercise. |
| FR-10 | Integration-tested | Core task creation and snapshot checks exercise local workspace data. Hierarchy, subtasks, and checklist controls appear in the workspace schema and drawer. |
| FR-11 | Prototype | Workspace schema and detail drawer support task metadata, priority, descriptions and alarm settings. Full per-list status customization and attachment authoring remain open. |
| FR-12 | Implemented | `ClickUpWorkspaceView`, `TaskDetailDrawer`, and calendar implement list, drag-and-drop board, and task details. Browser parity remains open. |
| FR-13 | Implemented | Workspace filter/group controls and `CommandPaletteModal` provide local search. Combined filters and keyboard behavior need checks. |
| FR-14 | Implemented | `task_dependencies`, `addTaskDependency`, and drawer relationship controls exist. Cycle handling and both visual directions were not exercised. |
| FR-15 | Integration-tested | Phase 2 verifies month-end clamping and rejection of an unsupported rule. Daily, workday and weekly rules are present in the recurrence service. |
| FR-16 | Integration-tested | Phase 2 verifies serialized custom fields through the task metadata service. Per-field browser editing remains open. |
| FR-17 | Integration-tested | Core timer test exercises start, stop, elapsed time, and local DND state. Hardware DND was not verified. |
| FR-18 | Integration-tested | Core approval test creates and undoes an agent-created task. Agent alarm and scheduling tools exist, with separate compensation gaps. |
| FR-19 | Integration-tested | Phase 3 creates and retrieves linked Markdown documents through `phase3-docs-io.service.ts`. |
| FR-20 | Integration-tested | Phase 3 covers Gantt/workload data. Workspace timeline rendering still needs interaction coverage. |
| FR-21 | Integration-tested | Phase 3 exercises CSV and Markdown import/export and formula neutralization on a fixture. |
| FR-22 | Implemented | Agent draft routing and `ScheduledChatCenter` expose recipient, delivery channel, time and body for approval. Core tests cover the scheduler gate independently. |
| FR-23 | Prototype | Scheduler stores contact timezone and active-hours notes. Agent uses parsed or default times, with no demonstrated calendar-aware recommendation. |
| FR-24 | Integration-tested | Core tick test verifies no dispatch before approval and the local manual fallback. Live sending, atomic claims, recovery and SMTP remain open. |
| FR-25 | Integration-tested | Core test observes pending, approved and fallback behavior. Manual delivery and other transitions need separate coverage. |
| FR-26 | Prototype | Gateway has Telegram, webhook, NectarLink and manual links. Baileys uses a separate driver. No live or SMTP validation. |
| FR-27 | Integration-tested | Phase 2 uses text and ZIP fixtures to verify parsing, deduplication, scrubbing and rejection of invalid archives. |
| FR-28 | Integration-tested | Phase 2 import and core notification fixtures exercise matching a local alias and retaining context. No live mention ingestion verified. |
| FR-29 | Integration-tested | Core notification and Phase 2 export tests exercise rule-based intent and urgency. Cloud classification accuracy was untested. |
| FR-30 | Implemented | `WaTagInboxView` and App expose task creation, reply, and accept or decline controls. Phase 4 verifies the server proposal gate. |
| FR-31 | Prototype | NectarLink notification ingestion and simulation route store browser-visible rows. Actual Android Notification Access delivery remains open. |
| FR-32 | Prototype | Tailscale and NectarLink paths exist. LAN mutual TLS and end-to-end notification transport lack verification. |
| FR-33 | Prototype | Notion database query imports calendar rows. Composio lists Google Calendar, with no unified two-way calendar reconciliation at baseline. |
| FR-34 | Implemented | `InteractiveVisualCalendar` supplies day, week and month views and a selected-date agenda. View coverage needs browser checks. |
| FR-35 | Prototype | Scheduler emits alarm events and calls NectarLink for phone delivery. Device acknowledgement remains open. |
| FR-36 | Implemented | `market.service.ts` implements Finnhub/RSS refresh and saved article state. No live refresh was executed. |
| FR-37 | Prototype | `economic_events` provides impact and schedule fields. Baseline reads seeded events without a demonstrated live macro feed. |
| FR-38 | Prototype | Market records store raw summaries and asset topics. Agent can process attached articles, with no verified automatic summarization pipeline. |
| FR-39 | Planned | X appears in the Composio catalog. The market service lacks a dedicated quota-limited X feed. |
| FR-40 | Implemented | `MorningBentoView` includes watchlist controls, TradingView embed, and attribution. External widget rendering was not established by the API smoke check. |
| FR-41 | Integration-tested | Core checks the four market sessions from a fixed date. Time-zone conversion uses `Intl`. DST transition boundaries lack a dedicated assertion. |
| FR-42 | Integration-tested | Phase 3 verifies journal metrics and R-multiple from fixture entries. |
| FR-43 | Implemented | Journal service records entries and computes metrics. The trader workflow has no order-placement path. |
| FR-44 | Implemented | `ThemeContext` and CSS define four themes. Contrast and persistence need browser coverage. |
| FR-45 | Implemented | App and `CommandPaletteModal` wire Cmd/Ctrl+K and results for local entities. Keyboard selection and focus need checks. |
| FR-46 | Implemented | Launcher route and whitelist select known applications. External app startup was not exercised. |
| FR-47 | Integration-tested | Core saves a fixture check-in and verifies high risk under selected input conditions. |
| FR-48 | Integration-tested | Core verifies preview proposal times avoid fixture blocked windows. Applying and compensating concurrent changes need tests. |
| FR-49 | Integration-tested | Core checks KPI data on a SQLite fixture. Individual percent, duration and streak calculations need dedicated coverage. |
| FR-50 | Implemented | Workspace goals and task links are in schema and UI. `recomputeGoalProgress` updates progress from task state. |
| FR-51 | Implemented | Workspace bottleneck report computes postponement and time by space. Weekly boundary behavior needs a check. |
| FR-52 | Integration-tested | Phase 5 checks recent context in an intercepted provider request. Sensitive routing and the identity content in the system prompt remain Phase 01 risks. |
| FR-53 | Prototype | `PhoneHubView` and `syncDevicesFromNectarLink` expose telemetry and local fallback. Pairing and live telemetry were not verified. |
| FR-54 | Prototype | Screen mirror method calls NectarLink and has a simulation path. Live mirroring, typing, and frame rate are unverified. |
| FR-55 | Prototype | Reply route calls NectarLink CLI for supported notifications. Actual Android reply and acknowledgement remain open. |
| FR-56 | Integration-tested | Core verifies timer-driven local DND state. Find Phone and other physical toggles were not exercised. |
| FR-57 | Prototype | Camera capture method records an attachment flow with simulated fallback. A live photo to task upload was not exercised. |
| FR-58 | Prototype | Phone service offers send and clipboard functions. LocalSend v2.1 interoperability and transport protection lack observed evidence. |
| FR-59 | Implemented | `device_timeline`, service writes and Phone Hub view track activities. Actual cross-device receipt remains open. |
| FR-60 | Integration-tested | Core verifies task-to-calendar projection, task start-date changes after moving the event, and alarm creation. It does not assert alarm timestamps after the drag. |
| FR-61 | Integration-tested | Core checks two alarm types and state transitions. WebAudio playback and phone delivery need runtime checks. |
| FR-62 | Implemented | Calendar/Alarm view, Top Command Bar and next-alarm query expose controls and countdown. |
| FR-63 | Implemented | Four Kotlin AppWidgetProvider layouts and metadata are present. Device rendering and interaction remain open. |
| FR-64 | Implemented | Companion includes exact alarm scheduling, permissions, and a receiver. Lock screen, Doze, and permission behavior require hardware validation. |
| FR-65 | Integration-tested | Core checks task toggling and idempotent widget deltas at the server. Alarm actions are implemented in the same service. Real device propagation remains open. |
| FR-66 | Prototype | LAN IP and NectarLink integration paths exist. No verified mDNS/QUIC/mTLS transport, frame rate, or LAN latency measurement. |
| FR-67 | Integration-tested | Core checks Tailscale status JSON using a fixture. Live Serve, client identity and offsite connectivity remain open. |
| FR-68 | Integration-tested | Core tests server-side widget snapshot and mutation deduplication. Offline cache, alarm and replay on Android remain open. |
| FR-69 | Implemented | Top Command Bar, network service and offline sync client expose status and reconcile affordances. Switching transports was not exercised. |
| FR-70 | Implemented | Baileys socket, QR pairing state and direct driver are present. Tests only cover status and mock send. |
| FR-71 | Integration-tested | Baileys fixture checks focused-thread send and cache updates. Modal rendering and live delivery still need validation. |
| FR-72 | Integration-tested | Phase 4 exercises the local topic detector. Broad classification accuracy is unmeasured. |
| FR-73 | Integration-tested | Phase 4 checks extraction and explicit acceptance before calendar insertion. |
| FR-74 | Integration-tested | Phase 3 verifies calm versus tilt journaling metrics and their relationship to seeded check-ins. |
| FR-75 | Prototype | Task drawer provides a Markdown form with explicit save to linked workspace docs. The advertised autosave is outstanding. |
| FR-76 | Integration-tested | Phase 3 verifies CSV quoting and formula neutralization against a synthetic fixture. |
| FR-77 | Integration-tested | Phase 2 applies a seeded template and verifies generated tasks. |
| FR-78 | Implemented | `voice.ts` uses Web Speech API and synthesis. Recognition may depend on browser implementation. Latency and offline operation were unmeasured. |
| FR-79 | Integration-tested | Phase 2 verifies whitelist-related missing executable safety. No native launch was performed. |
| FR-80 | Implemented | APK/AAB scripts, Play assets, listing metadata, privacy and data safety docs are present. Release signing and store acceptance were unverified. |
| FR-81 | Implemented | Linux and Windows launch scripts plus a Tauri 2 project exist. Native packaging and standalone startup were unverified. |

Relevant code and assertions are in [server routes](../server/index.ts), [services](../server/services), [React components](../src/components), [core tests](../server/tests/core.test.ts), [Phase 2 tests](../server/tests/phase2.test.ts), [Phase 3 tests](../server/tests/phase3.test.ts), [Phase 4 tests](../server/tests/phase4_proposal.test.ts), [Baileys tests](../server/tests/baileys.test.ts), [Android source](../android-widgets/app/src/main), and [Play release files](playstore).

## Additional Phase 5 inventory

| Capability | Status | Baseline evidence and limit |
| --- | --- | --- |
| OpenCode, Groq, OpenRouter, Ollama and Gemini provider routing | Integration-tested | Phase 5 verifies fallback from an intercepted OpenCode rate limit to mocked Groq. Remaining live adapters and price verification are open. |
| Provider catalog, CLI parsing and persona | Integration-tested | Phase 5 verifies catalog and CLI parser fixtures. Actual CLI process, live catalogs and persona behavior remain open. |
| Persistent recent messages and bounded ReAct | Integration-tested | Phase 5 observes prior messages and a tool result across intercepted provider turns. The baseline keeps a short window, with no long-term memory index. |
| Composio catalog, OAuth link and sync | Integration-tested | Phase 5 uses fake OAuth/catalog responses and observes an active fixture connection. The display count describes potential toolkits and connected availability depends on the account. |
| Composio tool discovery, approvals and execution | Prototype | Mock checks a successful approved send. Baseline lacks central enforcement on the direct endpoint, authoritative read policy, bound one-time claims, and failure-safe result handling. |
| WhatsApp persistent threads | Integration-tested | Migration 005 and hydration store threads. Mocked focused-thread messaging and mention insert assertions passed. A real reconnection was untested. |
| Settings and desktop integration hub | Implemented | React views list settings, provider data, connections and tool logs. End-to-end browser and live consent flows remain open. |

See [Phase 5 tests](../server/tests/phase5_jarvis_composio.test.ts) and [Phase 01 acceptance criteria](LLAMREI_4_MASTER_UPGRADE_PLAN.md).

## Rendered baseline

Playwright Chromium rendered Overview and Tasks with anonymous fixtures at 360, 768 and 1440 px. Task navigation, Ctrl+K search focus and Ctrl+J copilot toggle worked at each width. Escape left the command palette open. At 360 px the task title measured zero width. At 360 and 768 px the sidebar pushed the Overview heading below most of the first screen and the command bar crowded its controls. No page exceptions or document-level horizontal overflow appeared. External requests and writes were blocked for this check.
