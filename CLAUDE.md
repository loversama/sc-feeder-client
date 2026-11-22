# VOIDLOG.GG Client: notes for agents and contributors

Electron + Vue 3 desktop client. The main process is in `electron/`, the renderer in `src/`, and shared
types in `shared/`.

Tests: `npm run test:parser`, `npm run test:telemetry`.
Build: `npm run build`, which runs vue-tsc, then vite, then the externals check.

## Packaging rules (mandatory)

Background: since 0.3.x, auto-updates sometimes left the app unable to start. It crashed with
`ERR_MODULE_NOT_FOUND: Cannot find package 'undici' imported from …\resources\app\dist-electron\main.js`.
The app shipped without asar, so an update wrote thousands of loose `node_modules` files. These were
written minutes after the new `main.js`, and launching in that window crashed on an externalized
pure-JS package. Fixed in 0.3.4. Keep it fixed:

1. **No new entries in the vite main-process `external` list unless the module is native.** The list
   in `vite.config.ts` is native-only: `better-sqlite3`, `bindings`, `node-gyp-build`. Every pure-JS
   dependency, such as undici, @grpc/grpc-js or protobufjs, is bundled into `dist-electron`.
   `scripts/check-externals.mjs` runs as part of `npm run build` and fails on any other bare import.
2. **Every external must be in `dependencies`**, not devDependencies. The externals check enforces this.
3. **asar stays on** (`"asar": true` in `electron-builder.json5`). Native modules are unpacked via
   `asarUnpack`. Code that reads files from the app directory must go through `app.getAppPath()`
   (inside app.asar) or `process.resourcesPath`, never a path guessed from `__dirname`. A new runtime
   file belongs in `REQUIRED_APP_FILES` in `electron/main.ts`.
4. **The packaged smoke test must pass before any release. Never ship without it.**
   - Local check: `npm run package:dir && npm run smoke:packaged`. On headless Linux, prefix the
     smoke step with `xvfb-run -a`.
   - CI: `.github/workflows/package-smoke.yml` runs the smoke test on Windows, macOS and Linux for
     every PR. `release.yml` requires it to pass on all three before publishing.
   - What it does: `--smoke-test` loads the whole main-process module graph, runs the bundled
     gRPC/protobuf code and better-sqlite3 from app.asar, checks the packaged files, opens no window
     and exits 0.
5. **Preloads are sandboxed, one self-contained file each.** They can only `require('electron')`;
   a split chunk such as `./index.mjs` cannot load. Add a new preload to `PRELOADS` in
   `vite.config.ts` (each one is built on its own with `inlineDynamicImports`) and to
   `REQUIRED_APP_FILES`. The externals check and the smoke test fail on chunk imports in preloads.
6. `electron/main.ts` is a tiny bootstrap that imports only Electron and Node built-ins. It
   dynamically imports `app-main.ts`, and a missing module becomes a "finishing an update" dialog with
   Retry instead of a raw crash. Keep it free of other imports. App start-up code goes in
   `startApp()` in `app-main.ts`; importing `app-main.ts` must have no app-level side effects.
7. A new HTML page needs its own input in `vite.config.ts` `build.rollupOptions.input`, and it must be
   loaded from `path.join(app.getAppPath(), 'dist', '<page>.html')` (or the dev server URL).

## Other conventions

- Some files are CRLF (e.g. `log-parser.ts`, `server-connection.ts`, `app-main.ts`). Preserve line endings.
- This repo is public. No real player handles, account ids or logs in fixtures; redact them to placeholders.
- Release notes are player-facing: no internals, no bug descriptions, no emoji.
