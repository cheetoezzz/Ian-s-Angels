# Compact Queue dashboard

This change reorganizes the existing Astro interface only. The scoring engine, rotation engine, attendance/partnership transitions, storage schema, IDs, routes, GitHub Pages configuration and PWA configuration are unchanged.

## Layout and components

`QueueDashboard.astro` now places Active Session, Attendance, Fixed Partners and Session Info in one desktop overview row. Current Game, Ready for Next Game and the roster form the main three-column row. Tablet uses two columns; mobile stacks Session, Attendance, Current Game, Ready, and the roster. Detailed Session Info collapses on smaller screens. The existing Add Player card remains accessible below the match area and through the roster’s Add Player shortcut. The existing live leaderboard preview is expandable; View Live Leaderboard still opens the full leaderboard.

Updated components: QueueDashboard, Participation, PlayerList and SessionInfo. Added FixedPartners as a compact overview presentation using the existing management handler. WaitingPlayers is reused inside the roster’s Waiting Next tab. Existing layouts, navigation, KAMPO SVG branding and native Astro components remain in use.

`src/styles/dashboard.css` overrides dashboard layout/spacing and supplies the bounded roster table and mobile rows. It is loaded by DashboardLayout after the existing KAMPO, participation and feedback styles; landscape scoring does not load these dashboard styles. The existing Bootstrap icon sprite includes a link icon for fixed partners.

## One roster, two tabs

`src/scripts/roster.ts` renders the existing player records and waiting order, with local UI preferences for search, filter, tab and preview expansion. It creates no independent roster store and writes no application data. The existing renderPlayerList/renderWaitingPlayers functions delegate to this presentation module. Existing player activation, removal and attendance handlers are passed through unchanged.

The desktop roster is a compact table with row number, name, attendance, session games (or total games when no session), fixed partner and actions. Its internal scroll area stays below 500px and the header stays visible. Search and All/Checked In/On Break/Not Arrived/Checked Out filters affect display only. Each row exposes activation, removal and applicable attendance actions in an expandable Actions control. On-court restrictions still come from the existing handlers.

Mobile Queue initially renders at most five matching players. View All Players opens the existing Players route, where the same component exposes the full roster at every width. Waiting Next uses the original queue ordering and eligible-games-waiting information, shows a five-player mobile preview and can expand into a bounded Full Queue view. Keyboard arrows/Home/End switch the accessible tabs.

Fixed-pair summaries are bounded and use the existing remove-pair confirmation. Mobile keeps a clearly labeled Fixed Partners action beside Manage Check-In; the full existing manager remains available. The dedicated Players page keeps registration, attendance/partnership management, search, filters, statistics, permanent activation and removal.

## Verification

- `npm test`: existing scoring, storage, migration, queue and smart-rotation simulations pass; the 30-game fairness results are unchanged.
- `npm run check`: 43 files; zero errors, warnings or hints.
- `npm run build`: six static pages built successfully; all emitted resources remain part of the existing generated offline cache.
- Dashboard browser coverage checks 0/4/12/20/40 players at 320/375/390/430/768/1024/1280/1440/1920px, including no page overflow, a bounded roster, top-row alignment, main-column alignment and exact storage equality after resize.
- Browser checks exercise search, attendance filters, keyboard tabs, original waiting order, mobile preview/full navigation, sticky headers, internal scrolling, roster attendance/activation/removal actions and mobile fixed-partner access.
- Existing scoring, serving, Golden Point, undo, current/next games, session history, backups, attendance, fixed-pair conflicts and offline workflows remain in the full browser suite.

The full Chrome run passed **17/17 workflows** in 46.0 seconds, including all 45 roster-size/viewport combinations. No business-rule or scoring assertions were removed; UI tests were adjusted to open the new row-actions disclosure and address the existing pair manager specifically.

Screenshots are saved in the ignored `.scoring-browser-test` directory, including `dashboard-desktop-40.png` and `dashboard-mobile-40.png`.

Names/partner labels truncate where necessary in compact cells; full labels remain available through accessible text, tooltips and management views. Row action expansion can temporarily increase that row’s height inside the bounded panel. Small screens still scroll to reach all scoring actions; controls have not been removed or reduced below their existing touch sizes. No commit, push or deployment is performed.
