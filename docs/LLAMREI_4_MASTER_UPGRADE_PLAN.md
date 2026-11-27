# LLAMREI 4.0 — Project Ascension
Status: proposed implementation specification; baseline 7797785 (2026-11-28 WIB). No runtime verification at baseline. Goal: premium personal JARVIS, local-first, human-governed; preserve all existing capabilities. Read AGENTS.md.

## Architecture
Retain React/Vite/TypeScript, Node, SQLite WAL, Kotlin Android and Tauri. Incrementally split server into core (agent, providers, memory/context, authority, missions, events, sentinel), domain services, integrations, routes, workers; client into design-system, layouts and feature modules. Existing API remains compatible. Use typed schemas, transactional migrations, event outbox, persistent jobs, bounded retries, idempotency and verified status. No microservice rewrite.
 
## Delivery phases and acceptance gates
| Phase | Deliverables | Gate |
|---|---|---|
| 00 P0 | Inventory FR-01–81 plus Phase 5; current scripts, baseline snapshots, tests, dependency and data audit | Evidence per feature: planned/prototype/implemented/integration-tested/operational; backup and test report |
| 01 P0 | Authority, privacy, auth/proxy trust, tool allowlist, schema validation, approval and audit, scheduler atomic claim/recovery, real device outcomes, cost caps, secret storage | Denied calls cannot execute; duplicate approval cannot cause duplicate side effects; failed/unknown execution never success; restore and sensitive cloud routing tests |
| 02 P0 | Obsidian Intelligence tokens, component library, accessible responsive shell, themes, navigation, command palette | Visual regression at 360/768/1440 widths, keyboard navigation, contrast/reduced motion |
| 03 P1 | Overview, task workspace, calendar, alarms, settings, search, copilot redesign | Existing CRUD, filters, drag/drop, schedule and alarms remain functional; real data and state coverage |
| 04 P1 | Provider adapters, model router, streaming, context, tool registry, validated costs, latency, circuit breakers | Multi-provider mocks and real opt-in smoke tests; free-only fails closed; no sensitive context leakage |
| 05 P1 | Personal memory, FTS5, local embeddings/hybrid retrieval, Knowledge Vault, Memory Explorer | Cross-session retrieval with source provenance, edits/deletion, privacy and retention tests |
| 06 P1 | Unified inbox and Composio, connection health, safe dynamic tool retrieval, follow-up and contact tracking | Active account/tool policy on all execution paths; approved writes only; dedup and delivery receipts |
| 07 P1 | Event bus/outbox, Sentinel, persistent missions, visual automation | Resume after restart/approval, cancel, time/budget caps, dry run, no duplicate sends, quiet hours |
| 08 P2 | Voice, vision, computer use with bounded permissions | Explicit mic/screen/camera opt-in, visible indicators, interruptible speech, sandboxed browser actions |
| 09 P2 | Trading Pro, Academic OS, Finance, Life OS, CRM, research and document intelligence | Real sources and calculations; no fabricated metrics/citations; no autonomous transactions |
| 10 P2 | Android companion and native widgets, trusted devices, always-on private host | Real device tests for reboot, offline, permission revocation, sync, alarm delivery and remote acknowledgments |
| 11 P2 | Packaging, performance, accessibility, CI and docs | All available regression tests pass; blockers honestly documented; release approval |
 
## Existing module upgrade requirements
- Cognitive Core: context across sessions, bounded adaptive ReAct, streaming, tool schema validation and dynamic registry, capability/health-aware provider routing, cited answers, free-only budget. Retain deterministic fallback and persona. Existing recent history is 10 messages, max 1200 chars each; 4 ReAct iterations. Do not silently discard prior tool observations or auto-run arbitrary write actions.
- Memory: working/episodic/semantic/preference/procedural/prospective stores; provenance, retention, review/edit/delete, FTS5 before local embedding; opt-in ingestion. Treat retrieval as untrusted content.
- Workspace: inbox, list, board, Gantt/timeline, dependencies, subtasks, fields, recurring tasks, rich text, attachments, history, saved filters, bulk actions, templates, time tracking; preserve existing hierarchy and IDs.
- Calendar: day/week/month/agenda, recurring events, drag/drop, sync reconciliation, conflict detection, buffers, rescheduling preview and time audit. No silent external changes.
- Alarms: native Android exact alarm where permitted, soft/hard/escalation, snooze, acknowledgements, recovery on boot/timezone change, offline diagnostics and history. Test actual devices, not just simulated success.
- Communication: Baileys optional, WhatsApp/Gmail/Telegram/Composio inbox, thread persistence, summaries, commitments, proposals, drafts, scheduled send, follow-up, recipient previews, dedup, retry/recovery. Unofficial protocols can break; disclose. Never send live messages in tests.
- NectarLink/device hub: capability discovery, battery/health, clipboard/file sync, mirroring, Find Phone, DND, notifications, pairing/revoke, command acknowledgement. Distinguish simulated, pending, offline, unknown, verified.
- Trading: equity/drawdown, expectancy, profit factor, risk sizing, setup/session performance, screenshots, import CSV/statement, news risk, pretrade checklist, cooldown, journal/review. No autonomous execution; correlation not causation. Verify PnL inputs.
- Life OS: check-ins, daily/weekly/quarterly reviews, habits, goals, focus, sleep optional, user-defined metrics; do not score human worth.
- Composio: account marketplace, OAuth status, scopes, connection health, tool inspector, per-tool policy, audit/revoke, dynamic relevant tool search replacing 4 toolkit/24 tool cap only after security gate. Do not assume 150+ apps actually connected.
- Market/Notion/docs/IO: freshness timestamps, source provenance, rate limits, conflict handling, import/export fidelity, offline status, error recovery. Preserve existing routes and integrations.

## New capabilities and scope
Sentinel event rules; Mission Control persistent state/checkpoints and approval resume; Voice Core (wake word, VAD, STT/TTS, interruption); Vision Core with opt-in screen/camera; restricted Computer Use; Automation Studio trigger/condition/action/approval with dry run; Knowledge Vault and universal search; Academic OS thesis chapters, revisions, literature/DOI, APA7, course/assignment/grade tracking; Personal Finance read-only accounts, cash flow, budgets, bills, receipts, trading capital separation; Meeting Intelligence consent-based transcription, minutes and action items; Personal CRM follow-up; Research Agent verifiable web sources; Developer Console GitHub/build status; Smart Capture; Document Intelligence PDF/DOCX/spreadsheet; opt-in Home Automation; System Health Center; Privacy Center; Android mobile companion.
 
## P0 detailed defects at baseline
- server/services/composio.service.ts: regex read-only classifier is not authorization. executeComposioTool does not enforce active enabled account/tool allowlist; direct POST /api/composio/tools/execute bypasses approval. Gate all callers centrally. Explicit deny unknown tools, schema validation, account binding, authoritative tool metadata; test direct route and hallucinated tool names.
- server/services/llamrei-agent.service.ts: approveAuditAction marks approved_executed even if Composio returns ok:false; read-pending then execute risks duplicates; edited args need validation and binding. Atomically claim with durable execution state, never retry ambiguous external writes blindly, distinguish unknown outcome. Undo must not claim reversal of already sent messages; alarm/calendar and auto-schedule need correct compensation.
- Sensitive history and tool outputs can flow to cloud after current-prompt heuristic; system prompt includes hardcoded PII. Remove personal identifiers from code, local-only by default for sensitive context across all steps/providers; redact logs. Review public repository history separately with owner.
- ai-provider.service.ts: cost calculation only charges some Gemini calls, assumes provider free status. Verified pricing/catalog, reject unknown cost in free-only, budget reserve before request, record actual usage where available, clear estimated vs actual.
- nectarlink.service.ts: simulated success without device acknowledgement; report actual capability/status.
- scheduler.service.ts: overlapping ticks and stranded sending state; atomic conditional claim, idempotency, delivery reconciliation and crash recovery.
- server/index.ts: review loopback bypass behind Tailscale Serve and trusted proxy boundaries; no assumption that proxy origin means trusted user.
- secret.service.ts: predictable fallback key derivation; use secure OS vault or random key protected by user secret and file permissions, migration plan.

## Implementation practices
Start with targeted tests and small commits, draft PR to develop/llamrei-4, no merge to main. Preserve user data, inspect schema migration order. Prefer established dependencies only after compatibility review (Radix/shadcn-style primitives, Lucide, Motion, TanStack, dnd-kit, Tiptap, Recharts/ECharts, React Flow, Zod, sqlite-vec, Ollama, openWakeWord, Whisper, Piper, Playwright, Vitest). Confirm API/provider availability and licenses; do not hardcode stale pricing. Keep build local-first and fallback usable without external keys.
 
## Quality targets
SaaS $10k is a qualitative goal, not valuation. Target WCAG 2.2 AA, 60 FPS on target hardware, local navigation <150ms, palette <100ms, cold dashboard <2s under normal local conditions; measure and report conditions. Real data, loading/empty/error/offline states, accessible keyboard, visual regression, rollback/backup, device validation. Do not mark release ready without evidence. See design system and progress log.
