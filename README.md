<a id="readme-top"></a>

<br />
<div align="center">
  <img src="public/blendproof-splash-v1.png" alt="BlendProof" width="640">
  <h3 align="center">BlendProof</h3>
  <p align="center">
    Blender-grade 3D review in the browser — the original .blend never leaves your machine.
    <br />
    <a href="https://blendproof.itycon.cn"><strong>Open the live site »</strong></a>
    ·
    <a href="#usage">Quick start</a>
    ·
    <a href="docs/LOCAL_MILESTONE_ACCEPTANCE.md">Acceptance record</a>
  </p>
</div>

**English** · [简体中文](README.zh.md)

> [!NOTE]
> Phase 4 (cloud replacement) is complete and deployed to `blendproof.itycon.cn`. End-to-end acceptance in a real browser — admin login, publishing a real `.blend`, and cross-browser comment/expiry/cleanup — is still pending. Details in [`docs/PHASE_4D_DEPLOYMENT_RECOVERY.md`](docs/PHASE_4D_DEPLOYMENT_RECOVERY.md).

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#about">About</a></li>
    <li><a href="#features">Features</a></li>
    <li><a href="#architecture">Architecture</a></li>
    <li><a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#development">Development</a></li>
    <li><a href="#api">API</a></li>
    <li><a href="#deployment">Deployment</a></li>
    <li><a href="#retention-and-quotas">Retention and Quotas</a></li>
    <li><a href="#known-limitations">Known Limitations</a></li>
    <li><a href="#faq">FAQ</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
  </ol>
</details>

## About

BlendProof is a web 3D review tool with a Blender-style shell. A `.blend` file is converted to GLB by a Blender process on your own machine; only the trimmed `model.glb`, a cropped `manifest.json`, and an optional `thumbnail.webp` are ever allowed to reach the cloud. Reviewers open a link, inspect the model in the same viewer the uploader used, and annotate directly on surfaces.

**Why:**

- **The source never leaves your machine.** `.blend` files only go to a loopback bridge. The Worker rejects them with HTTP 415 — this is enforced in code, not by convention.
- **Reviewers do not need Blender.** A single link opens the model with camera state, display mode, and hidden objects restored from the URL fragment.
- **No infrastructure bill.** Cloudflare Workers, D1, and private R2 back a 5 GiB public pool with automatic 48-hour cleanup.

The uploader and the `/s/<token>` share route are the same application and the same viewer component — there is no second front end to keep in sync.

Product and account conventions — home page layout, roles, invite codes, and retention policy — are collected in [`docs/PRODUCT_CONVENTIONS.md`](docs/PRODUCT_CONVENTIONS.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Features

- **Blender-style navigation** — middle-drag orbit, Shift+middle-drag pan, wheel zoom, box select, blank-space deselect, `/` to isolate, wireframe/shaded/material modes, and file cameras.
- **Outliner** — search objects by name or type, select and frame with the keyboard (numpad `.`).
- **Review annotations** — surface-anchored comments, numbered pins, edit/resolve/reopen, and stable camera replay on the persisted state.
- **Controlled sharing** — `/s/<token>` with read-only or comment permission, optional password, expiry, and revocation. `#view=...` restores the sender's camera, display mode, hidden objects, and selection.
- **Accounts** — invite-code registration, `admin` / `user` roles, and per-user space accounting.
- **Admin console** — member usage and deactivation, invite creation/revocation, and platform thresholds inside the 5 GiB / 48-hour ceilings.
- **Platform status** — persisted uptime, cumulative files/bytes processed, and cleanup counters, refreshed live on the home page.
- **Permanent demo** — `/s/suzanne` serves a read-only example model with the public demo passphrase `tycon`; it counts against no quota and is exempt from cleanup.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Architecture

Three layers, with the trust boundary drawn at the loopback bridge.

| Layer | Stack | Location | Responsibility |
|---|---|---|---|
| Web | React 19, `@react-three/fiber`, `@react-three/drei`, three.js, Vite, TypeScript | `src/` | Upload workspace, Blender-style viewer, outliner, annotations, share UI |
| Local bridge | Express 5, `multer`, `node:sqlite` | `server/` | Accepts `.blend` on loopback, drives Blender headless, exports GLB + manifest, serves the local development API |
| Cloud | Cloudflare Workers, D1, private R2, hourly cron | `worker/` | Auth, invite codes, upload intents, quota ledger, shares, comments, scheduled cleanup |

**Publish flow:**

1. The browser hands the `.blend` file to the local bridge on loopback.
2. Blender runs headless and writes `model.glb` plus `manifest.json` into `storage/projects/<project-id>/`.
3. The viewer loads the GLB and the uploader reviews it.
4. On publish, the Worker issues an upload intent and the browser PUTs only `model.glb`, the cropped `manifest.json`, and an optional `thumbnail.webp`.
5. D1 reserves quota, then settles it on finalize; a share token is created.
6. Reviewers open `/s/<token>` and the same viewer component reads the derived assets.

**Key invariants:**

- The Worker never accepts or stores a `.blend`, `multipart/form-data`, or `application/x-blender` body — see `worker/index.ts:23`.
- Mutating routes require an `Origin` header that exactly matches `APP_ORIGIN`; see `worker/index.ts:56`.
- Public responses are recursively scanned so owner capabilities, tokens, password hashes, storage namespaces, and R2 object keys never leak.
- R2 stays private; it is reachable only through the Worker's `ASSETS` binding.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting Started

### Prerequisites

- **Node.js >= 22.12.0** — required by `package.json` because the local database uses `node:sqlite`.
- **Blender** — installed locally. The default lookup targets the Steam install on macOS; override with `BLENDER_BIN`.
- **macOS** — the `.blend` conversion path and default Blender paths are currently macOS-only.

### Installation

```sh
npm install
npm run dev
```

Open `http://localhost:5173`. Three ports are involved:

| Port | Process |
|---|---|
| 5173 | Vite web app |
| 8788 | Local Blender bridge |
| 8787 | Local Cloudflare Worker (`npm run worker:dev`, optional) |

`npm run dev` injects a fixed local pairing code so the browser can reach the bridge. To point at a specific Blender build:

```sh
BLENDER_BIN="/Applications/Blender.app/Contents/MacOS/Blender" npm run dev:server
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

1. Start the dev server and open `http://localhost:5173`.
2. Select a `.blend` file. The bridge converts it in the background; the browser loads the resulting GLB.
3. Inspect the model — orbit, isolate objects, switch camera and display mode.
4. Add review comments on the model surface, then resolve or reopen them.
5. Create a share, copy the link, and open it in a second browser to verify read-only or comment access.

To generate a dependency-free scene for testing (two meshes, ground, light, camera — no Geometry Nodes):

```sh
npm run create:test-blend
```

This writes `test-assets/simple-review-scene.blend`. Import it, click "create local test share", then open the generated `/s/<token>` link to verify the client-side read-only load.

<details>
  <summary>npm scripts</summary>

| Script | Purpose |
|---|---|
| `npm run dev` | Run the web app and the local bridge together |
| `npm run dev:web` | Vite only, bound to `127.0.0.1` |
| `npm run dev:server` | Local Express bridge only (`tsx watch`) |
| `npm run build` | Type-check and build the web bundle into `dist/` |
| `npm run start` | Run the local bridge without watch mode |
| `npm run create:test-blend` | Generate the simple review scene |
| `npm run create:viewer-fixtures` | Generate the three viewer acceptance fixtures |
| `npm run check` | Type-check the web and server sources |
| `npm run check:worker` | Type-check the Worker against `tsconfig.worker.json` |
| `npm run test:backend` | Local backend test suite via `node:test` |
| `npm run test:worker` | Worker test suite via Vitest + `@cloudflare/vitest-plugin` |
| `npm run worker:dev` | Run the Worker locally against Miniflare |
| `npm run worker:dry-run` | Build the Worker bundle into `dist-worker/` |
| `npm run worker:types` | Regenerate `worker-configuration.d.ts` |

</details>

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Development

**Where things live:**

```
blendproof/
├── src/            React web app: viewer, outliner, annotations, upload workspace
├── server/         Local Express bridge, Blender export scripts, SQLite layer
│   └── blender/    Headless export and fixture-generation Python
├── worker/         Cloudflare Worker: auth, uploads, shares, rate limits, cleanup
├── migrations/     D1 schema, 0001 through 0009
├── tests/          Local backend tests (node:test)
├── docs/           Long-form design, acceptance, and deployment records
├── public/         Default demo GLB, manifest, and splash art
├── test-assets/    Development fixtures; excluded from runtime storage
└── storage/        Local project data (git-ignored)
```

**Quality gates.** Run at minimum:

```sh
npm run check
npm run check:worker
npm run test:backend
npm run test:worker
```

Run `npm run build` before shipping web changes and `npm run worker:dry-run` when touching the Worker. Confirm the dry-run bundle contains no `.blend`, `.dev.vars`, local database, or `storage/` content.

**Working conventions** are recorded in [`AGENTS.md`](AGENTS.md): stable product boundaries, the requirement that the Worker enforces authorization rather than the UI, and the rule that real Cloudflare resources, DNS, secrets, and remote migrations require explicit approval. Long-term state lives in [`.planning/STATE.md`](.planning/STATE.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## API

The Worker serves `/api/*` ahead of static assets; everything else falls back to the SPA.

<details>
  <summary>Worker routes</summary>

**Public**

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Runtime probe: reports Worker, D1, and R2 bindings |
| `GET` | `/api/public/stats` | Public platform metrics (cached 30s) |
| `GET` | `/api/me` | Current identity; anonymous callers get an empty identity |
| `GET` | `/api/me/stats` | Own space and project usage |
| `POST` | `/api/auth/bootstrap-admin` | One-time admin seed; disabled permanently after first success |
| `POST` | `/api/auth/register` | Invite-code registration |
| `POST` | `/api/auth/login` | Password login |
| `POST` | `/api/auth/logout` | Session teardown |

**Projects and uploads**

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/projects` | Create a project; rejects `.blend` bodies with 415 |
| `POST` | `/api/projects/:id/upload-intents` | Reserve quota and issue a signed upload intent |
| `PUT` | `/api/projects/:id/assets/:asset` | Upload `model.glb`, `manifest.json`, or `thumbnail.webp` |
| `POST` | `/api/projects/:id/finalize` | Settle the quota reservation |

**Shares and comments**

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/projects/:id/shares` | Create a share |
| `DELETE` | `/api/projects/:id/shares/:token` | Revoke a share |
| `GET` | `/api/projects/:id/comments` | Owner-side comment list |
| `PATCH`/`DELETE` | `/api/projects/:id/comments/:commentId` | Owner-side edit or delete |
| `POST` | `/api/shares/:token/access` | Unlock a password-protected share |
| `GET` | `/api/shares/:token/status` | Share metadata and expiry |
| `GET` | `/api/shares/:token/:asset` | Read `model.glb` or `manifest.json` |
| `GET`/`POST` | `/api/shares/:token/comments` | Guest read or post comments (comment permission required) |

**Admin**

| Method | Path | Purpose |
|---|---|---|
| `GET`/`POST` | `/api/admin/invites` | List or create invite codes |
| `DELETE` | `/api/admin/invites/:id` | Revoke an invite code |
| `GET` | `/api/admin/users` | Member list with usage |
| `POST` | `/api/admin/users/:id/disable` | Deactivate a member |
| `GET`/`PATCH` | `/api/admin/settings` | Read or lower platform thresholds |
| `GET` | `/api/admin/stats` | Platform-wide statistics |

</details>

The review data contract is specified in [`docs/REVIEW_CONTRACT.md`](docs/REVIEW_CONTRACT.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Deployment

The production Worker, D1 database, private R2 bucket, hourly cron, and custom domain `blendproof.itycon.cn` are live. `wrangler.jsonc` holds the real resource IDs, so it is no longer a placeholder config.

```sh
npm run build                 # emit dist/ for Worker static assets
npx wrangler d1 migrations apply <database> --remote
npx wrangler deploy
```

Order matters: apply D1 migrations before deploying, and confirm `APP_ORIGIN` matches the live HTTPS origin exactly, with no trailing slash. Secrets (`UPLOAD_SIGNING_SECRET`, `SHARE_ACCESS_SECRET`, and the one-time `BOOTSTRAP_ADMIN_TOKEN`) are set through Wrangler secrets and never committed.

The authorization gates, secret handling, migration sequence, two-browser acceptance checklist, and rollback runbook are in [`docs/PHASE_4D_DEPLOYMENT_RECOVERY.md`](docs/PHASE_4D_DEPLOYMENT_RECOVERY.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Retention and Quotas

| Limit | Value |
|---|---|
| Public pool capacity | 5 GiB |
| Maximum project retention | 48 hours (even without a share) |
| Default share lifetime | 24 hours |
| Cleanup schedule | Hourly cron, `0 * * * *` |

D1 acts as the atomic quota ledger: reservations happen at upload intent, settlement at finalize, and release on failure or expiry. The cron job deletes by exact R2 key and retries unfinished ledger entries. The `/s/suzanne` demo model is exempt from both quota and cleanup.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Known Limitations

- **Geometry Nodes simulation zones.** `test-assets/zhuzhiliao_geometry_nodes_substep_core.blend` exports and loads successfully, but its Simulation Zone cannot be evaluated in Blender's background mode, so the native glTF exporter omits some stub meshes. The next step is to surface these warnings as a conversion report and offer a headless-bake or "already baked" path.
- **Production acceptance is incomplete.** Admin login, a real `.blend` publish, and cross-browser comment/expiry/cleanup have not yet been verified against the live environment.
- **`node:sqlite` is experimental.** It works on Node 22 but emits an `ExperimentalWarning`; the runtime version is pinned and the D1 adapter boundary is kept intact.
- **macOS only.** The Blender bridge and default binary lookup currently target macOS.
- **Local pairing codes are for development.** The fixed code in `npm run dev` is a local convenience; production still needs an out-of-band pairing entry point.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## FAQ

**Does the server ever see my `.blend` file?**
No. The file goes only to the loopback bridge. The Worker returns HTTP 415 for `.blend`, `multipart/form-data`, and `application/x-blender` bodies, and publishing sends only the derived GLB, cropped manifest, and optional thumbnail.

**Do reviewers need Blender installed?**
No. They need a browser and the share link. Blender is only required on the machine that converts and publishes.

**How long does a share stay alive?**
24 hours by default. Projects are hard-capped at 48 hours regardless of sharing, and an hourly cron deletes expired derived assets.

**What is `/s/suzanne`?**
A permanent read-only demo model with the public passphrase `tycon`. It is exempt from quota and cleanup and cannot accumulate unowned annotations.

**Why do I need a Node version so new?**
`>= 22.12.0` is required for `node:sqlite`, which the local bridge uses as its development database.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributing

BlendProof is a private repository with no remote configured, so it does not accept external pull requests. Contributions happen in-tree: follow the boundaries in [`AGENTS.md`](AGENTS.md), run the quality gates above, and verify UI changes in a real browser rather than relying on a successful build.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

UNLICENSED — all rights reserved. This is a private project with no `LICENSE` file; nothing here grants permission to use, copy, modify, or distribute it.

<p align="right">(<a href="#readme-top">back to top</a>)</p>
