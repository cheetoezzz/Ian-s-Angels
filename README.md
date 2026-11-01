# KAMPO Pickle Ball

A static Astro 7.4.4 and TypeScript application for one-court player rotation, traditional doubles scoring, session history and points-based rankings. No backend or frontend framework is required. All records stay in the browser’s existing `pickleball_queue_data` localStorage key.

## Run locally

Use Node **24 LTS** (minimum supported version: 22.23.4).

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:4321/Ian-s-Angels/**. Use the printed local address if Astro chooses another port.

```sh
npm run check
npm test
npm run build
npm run preview
```

Production preview: **http://127.0.0.1:4321/Ian-s-Angels/**. The production build goes into `dist/`. Offline caching is enabled in production preview and HTTPS hosting, not during development.

## Features preserved

- Smart Fair Rotation with eligible waiting/opportunity priorities, deterministic teammate/opponent/group mixing, optional fixed partners, stable prepared lineups and explicit Start Next Game. Winner Priority remains a small preference in the same engine.
- Session-specific check-in, late arrivals, breaks, checkout/return and confirmed bulk attendance controls, separate from permanent registration activation.
- Player registration, original IDs, active/available status, removal safeguards and play history.
- Active session lifecycle, current match, waiting order, cancellation history and session statistics.
- Direct nonnegative integer final scores, including ties. Manual overrides retain the existing scoring audit.
- Traditional doubles side-out scoring, explicit starting right-side players, initial 0-0-2 call, two-server turns, court positions and diagonal receiver.
- Targets of 11, 15 or 21; Standard win by two and Sudden Death / Golden Point. Changing the rule locks after progress, including after Undo, until Reset.
- Rally undo, corrections, reset, input guarding, refresh restoration, match/revision protection and once-only completion.
- Points-based leaderboard, point-difference/wins tie breaks, search/sort, final podium only after the session ends, historical snapshots and match details.
- JSON backup export/import, legacy migrations and explicit destructive data tools.
- Same-browser storage events and Web Locks where supported. This does not synchronize different devices.

Queue now also exposes the ending rule before scoring begins and saves direct score edits on change. These use the existing match record and scoring engine.

## Structure

```text
src/
  pages/                    index, scoring, leaderboard, sessions, players, data
  layouts/                  BaseLayout, DashboardLayout, ScoringLayout
  components/
    layout/                 Header, Brand, Navigation, PageHeader
    dashboard/              AddPlayer, ActiveSession, CurrentGame,
                            ReadyNextGame, WaitingPlayers, PlayerList,
                            LeaderboardPreview, SessionInfo, QueueDashboard
    scoring/                ScoringShell (scoreboard and setup/correction dialogs)
    ui/                     DashboardDialogs
  lib/application.ts        Existing queue, sessions, rankings, backups and renderers
  lib/scoring/engine.ts     Typed, immutable original scoring transitions
  lib/dom.ts                Shared DOM control access
  lib/paths.ts              Base-aware page and asset URLs
  state/appStore.ts         Storage reads, stale-write checks and subscriptions
  scripts/                  Dashboard, scoring and production PWA initialization
  styles/                   Responsive structure and KAMPO themes
  types/                    Players, games, sessions, rankings and scoring contracts
public/                     Original images, correctly sized icons and manifests
scripts/                    PWA icon preparation and build-specific offline cache
tests/                      Original-suite adapter, store/migration and browser tests
.github/workflows/          GitHub Pages build and deployment
docs/MIGRATION.md           Original function map, data contracts and design limitations
```

The original root HTML, JS and CSS remain as reference snapshots; Astro does not publish them. Make application changes in `src/`. The previous README is preserved in [docs/LEGACY-README.md](docs/LEGACY-README.md).

## Data migration and safety

Existing schema 2 sessions and legacy flat `currentGame` / `pastGames` backups remain importable. Schema 3 adds session attendance, fixed pairs and rotation history without changing storage keys or record IDs. Older active sessions preserve previous eligibility and request attendance confirmation; new sessions start with everyone Not Arrived. Scores, partner/opponent history, pending assignments, cancelled games, final leaderboards, scoring history and manual audit fields are preserved. Missing ending rules default to Standard. Normalization is idempotent and does not clear storage on startup. The original import checks and replacement confirmation remain. See [Smart Rotation and Attendance](docs/ROTATION.md) for the algorithm, field contracts, controls, test results and limits.

The shared TypeScript store rejects writes from a stale read, rather than replacing newer storage. The scoring controller additionally keeps the original match/revision guards and Web Lock. The Queue and Scoring page share `activeSession.currentGame`; no separate scoring copy is persisted. Preserve the existing production origin to retain saved browser data.

## Responsive design and branding

The KAMPO red, charcoal, white and gold theme includes a mobile bottom navigation, desktop sidebar and header, white dashboard cards, gold actions/status, and red/black landscape scoring panels. Layouts support narrow portrait screens and short landscape screens. Landscape/fullscreen locking is attempted where supported; portrait controls remain functional.

Queue uses four compact desktop overview cards above Current Game, Ready for Next Game and a Players/Waiting Next panel. The roster has search, attendance filters, a sticky table header and internal scrolling. Mobile initially shows five players and links to the existing Players page for full management. See [dashboard layout and verification](docs/DASHBOARD.md).

Empty states share clear icons, headings and next steps. Success/error notices are dismissible and pause while hovered or focused. In-app confirmation dialogs support keyboard cancellation and focus restoration; destructive actions use red styling and explicit labels. Forms show inline validation, and failed storage writes never report success.

UI icons use a locally served subset of Bootstrap Icons (MIT), shared by Astro components and browser-rendered messages. The selected SVG sprite is rebuilt by `scripts/prepare-ui-icons.mjs`, with its license included in `public/icons`. Empty-state icons use plain, muted styling without decorative gold tiles.

The supplied standalone `kampo-logo-white.svg` and `kampo-emblem-white.svg` are preserved and used for the header/sidebar and PWA icons. The compact header combines the supplied emblem with a crop of the original wordmark; no logo paths are redrawn. Original source images remain archived; the welcome animation uses the KAMPO emblem. The composite mockup is a design reference, not used as an application background.

## Verification

```sh
npm run check
npm test
npm run build
npm run test:browser
```

`npm test` compiles the migrated TypeScript and runs the existing queue/scoring assertions against it, then checks store conflicts and actual legacy/modern migration idempotency. It does not merely retest the original root JS.

Browser tests use installed **Google Chrome** and start an isolated production preview on port 8765. They use isolated test-browser storage, never personal browser data. They cover:

- Registration, active status, dedicated routes, direct scores, pending promotion, final podium and historical results.
- Queue widths 320, 375, 390, 430, 768, 1024, 1280, 1440 and 1920; 44px scoring controls; landscape 844×390, 667×375 and 568×320; portrait 390×844.
- Side-outs, duplicate taps, undo, corrections, rule locks, refresh, Golden Point, cross-tab updates and once-only finalization.
- Backup export/import, legacy import, stable IDs and repeated migration.
- Offline reload, every generated route, match query URLs, PWA icon requests and offline scoring mutations.

Screenshots go to `.scoring-browser-test/`; failure traces go to `test-results/`. These artifacts are ignored by Git. Chrome must be installed; set the Playwright channel in `playwright.config.ts` for another supported local browser.

Final local verification: type checking reported **0 errors, 0 warnings, 0 hints**; migrated regression/store/migration suites passed; the production static build succeeded. See `docs/MIGRATION.md` for the browser verification record. Real iOS/Android installation and orientation locking still depend on browser/OS support and were not tested on physical devices.

## PWA and offline updates

`npm run build` creates the 192px/512px icons from the supplied KAMPO emblem and generates `dist/service-worker.js` from all emitted pages and fingerprinted assets. The full build is precached before activation. Navigation falls back to its exact cached page, ignoring the match query string; static module caching handles preview servers’ `Vary: Origin`. Prior build caches are retained to support tabs still using old fingerprinted imports. This favors safe open-tab upgrades over aggressive cache cleanup; older build caches can accumulate across releases.

Load the production app once online and wait for offline setup before using it without a connection. Failed precaching does not activate the incomplete build.

## GitHub Pages

Both Vercel and GitHub Pages are supported. Vercel builds use `/`; GitHub Pages retains `/Ian-s-Angels`. Use `npm run build:vercel` or `npm run build:github-pages` to generate and validate the matching static output. `vercel.json` publishes `dist` with the explicit Vercel build target; GitHub Actions selects the Pages target. See [hosting configuration, production diagnosis and verification](docs/HOSTING.md).

The production URL remains **https://cheetoezzz.github.io/Ian-s-Angels/**. Astro uses `site: 'https://cheetoezzz.github.io'`, `base: '/Ian-s-Angels'`, `output: 'static'` and file-format routes such as `scoring.html`. Original scoring URLs and hash bookmarks continue to work.

The workflow in `.github/workflows/deploy.yml` uses Node 24, `npm ci`, type checking, regression tests, static build and the official Pages artifact/deploy actions. In GitHub Settings → Pages, select **GitHub Actions** as the source. Publish by pushing reviewed changes to `main` or manually running the workflow:

```sh
gh workflow run deploy.yml
```

The manual command requires the reviewed workflow to already be on GitHub and an authenticated GitHub CLI. No commit, push, workflow run or deployment is performed by the local migration task.
