# Migration contract and feature map

The baseline queue and scoring suites passed before editing. The original vanilla files are retained at the repository root for comparison; Astro only ships `src/` and `public/`. `tests/run.cjs` runs the original assertions against the migrated TypeScript, not against those retained files.

## Existing behavior and dependencies

| Feature | Existing functions, retained in TypeScript |
| --- | --- |
| Data, schema 2, legacy flat history | `loadData`, `migrateData`, `migrateSession`, `migrateGame`, `migratePlayerStats`, `buildStatsFromGames`, `saveData` |
| Registration, IDs, availability, removal | `generateId`, `addPlayer`, `removePlayer`, `togglePlayerActive` |
| Queue priorities | `getActivePlayers`, `getCurrentPlayingIds`, `getWaitingPlayers`, `selectPlayersForGame`, `generateWinnerPriorityQueue` |
| Partner constraints | `getLastPartner`, `repeatsLastPartner`, `pairSelectedPlayers` |
| Session lifecycle | `startNewSession`, `updateSessionQueueMode`, `endSession` |
| Current and upcoming matches | `generateNextGame`, `isPendingValid`, `ensurePendingGame`, `regenerateNextLineup`, `transitionMatch`, `cancelCurrentGame` |
| Final scores and completion | `getScoreInputValues`, `validateManualScore`, `validateRecordedScore`, `validatePickleballScore`, `completeCurrentGame`, `applyGameToStats` |
| Rankings and podium | `getLeaderboard`, `getSortedSessionStats`, `renderLeaderboard`, `openLeaderboard`; points, point difference, wins, then ID |
| Backups and cleanup | `exportJson`, `importJson`, `clearPastSessions`, `resetAllData` |
| Traditional doubles | engine `create`, `rally`, `undo`, `correct`, `reset`, `validate`, `positionsFor`, `servingInfo`, `winner`, `setEndingRule`, `suddenDeathActive` |
| Scoring persistence and conflicts | `activeScoringGame`, `mutateScoring`, `withScoringLock`, shared `completeCurrentGame` |
| Browser UI | existing `render*` functions and listeners, initialized by dashboard/scoring entry scripts |

All application functions live in `src/lib/application.ts`, preserving their call relationships. The pure engine is `src/lib/scoring/engine.ts`. The dashboard renderer and scoring controller both read/write the same `activeSession.currentGame` through `src/state/appStore.ts`. No framework state or second scoring store is introduced.

Manual completion intentionally accepts nonnegative integer scores, including ties, just as the latest original code does. Landscape scoring enforces target 11/15/21 and Standard win-by-two or Golden Point win-by-one. Queue mode priorities and partner matching are unchanged. Final podiums remain limited to completed sessions.

## Data preservation

The sole application key is `pickleball_queue_data`. Existing migration normalizes legacy flat `currentGame`/`pastGames` into sessions and defaults missing ending rules to Standard. Schema 2, IDs, player history, pending games, cancelled matches, final leaderboard snapshots, `scoringState`, `scoringAudit`, and `resultSource` retain their existing contracts. Initialization never clears storage. Migration reads do not write until an existing mutation requires saving. Backup import validates before replacing records and keeps its existing confirmation.

The store adds optimistic raw-record checks before saving a previously read object; stale objects cannot overwrite a newer tab. Scoring keeps the existing Web Lock and match/revision checks. Storage events notify subscribers. Data remains local to the browser and origin; deploying to the same GitHub Pages URL preserves access.

## Branding assets

The final asset check located the standalone `images/kampo-logo-white.svg` and `images/kampo-emblem-white.svg`. Both are preserved and copied into `public/images` unchanged. The header/sidebar displays the actual supplied SVG artwork. Compact horizontal branding reuses the supplied emblem and crops the original logo's wordmark region using an SVG viewBox; no logo paths are redrawn. PWA icons use the supplied emblem on a red square with padding. Original Ian images remain intact for existing application uses, including the welcome animation.

## Offline updates

The production post-build script scans every generated HTML, CSS, JS, image, and manifest and creates a content-versioned service worker. Installation precaches the complete build before activation. Navigations use network-first with exact cached-page fallback (ignoring match query parameters); fingerprinted assets use cache-first. Old build caches stay available to already-open pages so updates cannot strand their old fingerprinted imports. A full build is required for offline verification; the dev server does not register a new worker.

Static cache lookups ignore `Vary` headers because all precached resources are same-origin build artifacts. This was verified against Astro preview, which varies module responses by Origin. Retaining old build caches can consume additional storage across releases.

## Deployment

Static Astro output uses the existing site and `/Ian-s-Angels` base with `.html` routes, including legacy scoring links. All generated asset/navigation URLs include the base. Hash links remain supported for existing bookmarks, while the five main destinations also have dedicated Astro pages. The workflow builds and deploys `dist` on main pushes or manual dispatch. Enable GitHub Pages → GitHub Actions when publishing. No commit, push, or deployment is performed by this migration task.

## Final local verification — 1 November 2026 (Singapore)

- `npm run check`: 35 source files; 0 errors, 0 warnings, 0 hints. Implicit any parameters are rejected.
- `npm test`: all original queue/scoring assertions run against migrated TypeScript, plus passing store conflict/subscription and actual legacy/modern migration idempotency checks.
- `npm run build`: 6 static pages, hashed browser modules/styles, valid 192px/512px icons and a worker precaching all 21 required build resources. No server adapter.
- `npx playwright test`: all 6 integration workflows passed in Chrome after integrating the supplied KAMPO SVGs (17.1 seconds). Covers direct and landscape scoring, Standard/Golden Point, rotation/next-game behavior, corrections, undo, refresh, finalization, history/podium, registration/status, backups/legacy import, cross-tab updates, nine dashboard widths and five scoring viewports.
- Offline browser verification includes every generated page, a scoring URL with a match query, refresh restoration and an undo mutation while disconnected. Browser contexts use isolated fixture data.
- The visible desktop, mobile and landscape screenshots were inspected. Screenshots are in the ignored `.scoring-browser-test` directory.
- Dependencies installed with no reported npm vulnerabilities. Physical iOS/Android installation and orientation/fullscreen permissions were not verified.

The supplied KAMPO assets are integrated and existing Ian artwork remains intact. The application's business rules, storage key and production URL are preserved. The original root application files remain reference snapshots; only `src/` and `public/` feed the Astro build.

## Feedback UI follow-up

Shared `src/lib/feedback.ts` and `src/styles/feedback.css` now provide consistent empty states, dismissible success/error notices and in-app confirmation dialogs on dashboard and scoring pages. Notifications pause on hover/focus, respect reduced motion and announce errors assertively. Confirmation dialogs support Escape, safe initial focus, focus restoration and clear destructive labels. Match/session identity checks prevent a pending confirmation from acting on a replacement record. Scoring setup/correction and player registration use inline validation. Mutations stop on a failed save instead of displaying a success notice.

Follow-up verification: type checking reports no diagnostics; migrated regression suites and the production build pass. The Chrome suite now contains nine workflows, adding feedback accessibility, confirmation cancellation/stale-match safeguards, storage-failure messaging and scoring required-field validation to the existing coverage. Production precaching now includes 22 resources, including the shared feedback stylesheet/module output.
