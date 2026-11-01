# Vercel and GitHub Pages hosting

## Confirmed production failure

The live Vercel HTML returned 200 at `https://kampo-delta.vercel.app/` but referenced `/Ian-s-Angels/_astro/...`, `/Ian-s-Angels/images/...`, `/Ian-s-Angels/icons/...` and `/Ian-s-Angels/manifest.webmanifest`. Every sampled prefixed stylesheet, module, KAMPO logo and manifest returned 404. The matching URLs on GitHub Pages returned 200. Vercel already served the files at the root (`/images/kampo-logo-white.svg`, `/manifest.webmanifest`, `/service-worker.js`), confirming that the generated base was incorrect for that host.

This was verified through public HTTP requests. The authenticated Vercel dashboard, production logs and account-level settings were not available in this session.

## Configuration

`config/hosting.mjs` is shared by `astro.config.mjs`, build validation and Playwright:

| Target | Site | Base |
| --- | --- | --- |
| Vercel | `https://kampo-delta.vercel.app` (or `VERCEL_PROJECT_PRODUCTION_URL`) | `/` |
| GitHub Pages / default local development | `https://cheetoezzz.github.io` | `/Ian-s-Angels` |

Vercel is detected automatically from `VERCEL=1`. `KAMPO_DEPLOY_TARGET=vercel` or `github-pages` explicitly selects the target for reproducible local builds. Invalid target values stop the build instead of silently choosing a path. Preview deployments use the root base and retain the production site origin.

The checked-in `vercel.json` explicitly uses:

- Framework: Astro.
- Install: `npm ci`.
- Build: `npm run build:vercel`.
- Output directory: `dist`.
- `cleanUrls: false`, retaining the existing `.html` navigation and offline routes.
- Revalidation for `/service-worker.js` so updated offline code is checked after deployment.

The target build command sets the target within its subprocess even if Vercel system variables are disabled. The GitHub Actions workflow explicitly uses `npm run build:github-pages` and continues uploading `dist` to the same Pages URL. Static output is retained; no server adapter, rewrite-all route or backend is introduced.

If reviewing account settings, the Vercel Root Directory must be this repository's Astro project root, and Node 24 is recommended (matching the existing GitHub workflow). The project already declares its supported Node version in package.json. No authenticated dashboard settings were changed automatically.

These choices follow the [Astro Vercel static deployment guide](https://docs.astro.build/en/guides/deploy/vercel/), [Astro base-path reference](https://docs.astro.build/en/reference/configuration-reference/#base), [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables) and [Vercel project configuration](https://vercel.com/docs/project-configuration).

## URL audit

No component or business-logic URL rewrites were necessary. Existing layouts, Brand, Navigation, PlayerList, ScoringShell and DashboardDialogs already use `import.meta.env.BASE_URL`; the shared `pageUrl`, `assetUrl` and icon helpers do the same. Astro handles imported CSS/TypeScript and fingerprinted module imports. The font stack uses local/system fallbacks, with no external font files or hardcoded font URLs.

Both manifest variants use relative start/scope/icon paths. The service-worker registration uses Astro's base, and its generated precache uses paths relative to the worker. These remain correct at both the root and repository subdirectory. Original Ian images, both KAMPO SVG assets, the icon sprite and PWA icons remain available. The build verifies every emitted page reference and offline resource.

The storage key and all scoring, rotation, attendance, fixed-partner, leaderboard and backup code are untouched. Nothing clears browser data or changes IDs. Each production origin retains its own existing browser storage; this change does not synchronize storage between Vercel and GitHub Pages.

## Build and verification commands

```sh
npm run check
npm test
npm run test:hosting
npm run build:vercel
npm run build:github-pages
```

Each target build runs the existing icon preparation, Astro build and PWA generation, then checks the six emitted pages, 236 local asset/navigation references, manifests, all existing images and 24 offline resources. Both targets share `dist`, so build them sequentially.

For a Vercel-style production preview in PowerShell:

```powershell
$env:KAMPO_DEPLOY_TARGET = 'vercel'
npm run build:vercel
npm run preview
```

Open `http://127.0.0.1:4321/`. For GitHub Pages:

```powershell
$env:KAMPO_DEPLOY_TARGET = 'github-pages'
npm run build:github-pages
npm run preview
```

Open `http://127.0.0.1:4321/Ian-s-Angels/`. Stop a preview before switching targets. To restore the default shell environment afterwards, run `Remove-Item Env:KAMPO_DEPLOY_TARGET`.

Playwright's base URL and preview server now select the same hosting target. After building the selected target, run `npx playwright test` in the same environment. Tests verify correct CSS/JavaScript MIME types, visible KAMPO images, navigation URLs, manifest and worker scopes, offline routes (including scoring query URLs), and preservation of existing localStorage, alongside all application workflows.

## Verification record

- Type checking: 0 errors, warnings or hints.
- Existing regression, storage, migration and smart-rotation suites: passed.
- Hosting configuration tests: 3 passed.
- Vercel build (`/`): passed, including all output reference checks.
- Vercel Chrome run: 19/19 workflows passed (44.3 seconds).
- GitHub Pages build (`/Ian-s-Angels/`): passed, including all output reference checks.
- GitHub Pages Chrome run: 19/19 workflows passed; the final Playwright run reports no failed tests.

## Release boundary

The fix is prepared and tested locally. No commit, push or deployment was performed. The existing live Vercel deployment still contains the old base until the reviewed changes are deployed. A new deployment is required to verify the corrected generated URLs on the actual production domain; local root-host checks must not be mistaken for verification of a newly published deployment.

Files added/modified: `astro.config.mjs`, `config/hosting.mjs`, `vercel.json`, `package.json`, `.github/workflows/deploy.yml`, `scripts/build-host.mjs`, `scripts/verify-build.mjs`, `playwright.config.ts`, `tests/hosting.test.mjs`, `tests/browser/hosting.spec.ts`, this report and the README hosting instructions. No UI, state schema or business logic was modified.
