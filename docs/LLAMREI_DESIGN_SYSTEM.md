# LLAMREI Design System — Obsidian Intelligence

## Product direction
Professional productivity workspace inspired by Linear/Raycast/Apple; cinematic JARVIS is an optional mode, not decoration across all pages. Premium SaaS quality means consistent detail, clear hierarchy, speed and accessibility, not a monetary valuation. Do not copy reference designs verbatim or assets without licenses. Indonesian UI by default, consistent localization, English technical labels where useful. No mock KPI in production.

## Tokens
Dark: void #09090B, surface #111318, elevated #191C23, border #292D38, text #F4F4F5, secondary #A1A1AA, intelligence #818CF8, core #22D3EE, success #34D399, attention #FBBF24, critical #F87171, agent #C4B5FD. Map tokens to semantic CSS variables; derive light theme with tested contrast, not inversion. Use accent sparingly; ensure contrast including focus and disabled states. Inter or Geist for UI, JetBrains Mono for telemetry, with system fallbacks. Use licensed fonts; avoid external network dependency by default. 4px spacing grid: 4/8/12/16/20/24/32/40/48; radii 6/8/12/16; body 14px desktop, 16px mobile where appropriate; headings 20–32px, caption 12px with adequate contrast. Subtle borders and shadows, no noisy neon. Lucide icons, consistent stroke and sizing; icon-only buttons have accessible labels. Motion 120–250ms, reduced-motion support.

## Shell and navigation
Desktop: collapsible/resizable sidebar (~240px), 48–56px top command bar, flexible workspace, optional right JARVIS drawer (~360px), no hardcoded viewport overflow. Mobile: bottom navigation or drawer, full-screen assistant, touch targets ideally >=44px. Main navigation groups Workspace (Overview, Inbox, Tasks, Calendar, Knowledge), Intelligence (JARVIS, Missions, Automations, Memory), Personal (Academic, Trading, Finance, Life OS, Devices), Settings/Integrations/System. Hide unreleased items or mark clearly as planned, not dead navigation. Preserve current routes and shortcuts. Command palette Cmd/Ctrl+K, existing Cmd/Ctrl+J opens JARVIS. Search results grouped by type; keyboard selection and escape.
 
## Page specifications
- Overview: morning briefing with JARVIS status, priorities, actual execution/focus/calendar/approvals metrics, upcoming schedule and activity timeline. User configurable widgets. Loading, empty, stale, disconnected, error and offline states.
- Task workspace: density controls, list/table/board/timeline, breadcrumb, filters, saved views, details drawer, quick create, bulk actions. Preserve existing hierarchy. Inline edit with validation and keyboard.
- Calendar: day/week/month/agenda, all-day row, current time, event detail, conflict preview, clear local vs external source. Alarm state from actual delivery/permission.
- Unified Inbox: source/filter column, conversation list, message thread + contextual AI/proposal panel. Recipient and action preview; unread, priority, pending and failed clearly separated. Mobile navigates between panes.
- JARVIS: streaming thread, source references, tool activity timeline, model/provider chooser, cancel/retry, context chips, approvals with exact action/recipient/payload, status and errors; no hidden execution. Cinematic optional orb with Idle/Listening/Thinking/Acting/Speaking/Error, mic/camera indicator; focus mode minimal timer and session controls.
- Trading: equity and drawdown chart, KPI with time period/currency, risk calculator, journal table, heatmap and filters; no market data without source and timestamp; accessible chart table alternative.
- Life/Academic/Finance: goal progress, revision and review timelines, expense categories, user-defined metrics, charts and drill-down, explicit empty state. No synthetic scores presented as measured.
- Integrations/Devices: connection status, actual capability, permissions, last sync, pairing/revoke, tool inspector, diagnostics. Simulated vs verified visibly distinct.
- Mission Control: steps, checkpoints, progress based on actual state, pending approvals, cancel/resume, errors and audit history.
- Automation Studio: keyboard-accessible list and optional graph builder, triggers/conditions/actions, dry-run and version history; no automatic activation.
- Memory/Knowledge: search, source preview, tags, edit/delete/retention and cloud consent.
- Settings: grouped preferences, provider budgets, security, privacy, backups, diagnostics; destructive operations confirm.

## Components and interaction states
Build reusable Button, IconButton, Input, Select, Checkbox, Switch, Dialog, Drawer, Tooltip, Popover, Dropdown, Tabs, Breadcrumb, Badge, DataTable, Chart, Card, Skeleton, EmptyState, ErrorState, Toast, StatusIndicator, ApprovalCard, CommandPalette. All interactive states: default/hover/focus/pressed/disabled/loading/error. Dialog focus trap, escape handling and restoration. Never hide essential actions only on hover. Use semantic HTML, screen-reader names and announcements. WCAG 2.2 AA target; normal text contrast >=4.5:1. Meaning not conveyed by color alone.

## References to review before implementation
Dribbble concepts (verify pages and attribution; visual inspiration only):
- https://dribbble.com/shots/27882811-Atrium-Run-your-day-in-10-seconds-AI-Executive-Dashboard
- https://dribbble.com/shots/27816043-AI-Powered-SaaS-Dashboard-Inbox-Task-Management
- https://dribbble.com/shots/27683835-TaskFlow-Task-Management-Dashboard
- https://dribbble.com/shots/27620569-OPERATE-SAAS-AI-teams-running-dashboard-analytics
- https://dribbble.com/shots/26567993-AI-Workflow-Builder-Dark-UI
- https://dribbble.com/shots/27333388-Trading-Analytics-Dashboard
YouTube JARVIS demonstrations (reference voice, vision, memory, device control; not tested integrations):
- https://www.youtube.com/watch?v=9S5flRQm3AM
- https://www.youtube.com/watch?v=CiGdcIlnXb8
- https://www.youtube.com/watch?v=SEyqYWQbGxc
- https://www.youtube.com/watch?v=I-cvxBMue08
Reference links from planning conversation are research leads; independently confirm validity and actual content before relying on them. 
## Validation
Capture baseline and redesigned screenshots at 360, 768, 1440px using synthetic fixtures; inspect clipping, overlap, hierarchy and consistency, test keyboard, reduced motion, accessibility and offline states. Compare functional parity with existing screens. Measure cold load, navigation and palette latency on target hardware. Do not claim production quality solely from screenshot. Use visual regression and E2E where possible. 
