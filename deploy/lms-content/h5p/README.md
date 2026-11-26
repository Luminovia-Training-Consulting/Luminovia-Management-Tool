# Dedicated H5P playback origin

Course staff can publish a reviewed `.h5p` archive in **Course workspace → Materials → Interactive H5P activities**. Learners open the activity from the same section. The portal stores completion and the learner's best reported playback score for the exact published package. The course assessment gradebook has its own release workflow. In an Academy licence grace period, staff and learners can open existing activities and read progress.

The player ships four reviewed families from the pinned upstream catalogue.

| Activity | Major and minor version |
| --- | --- |
| True/False Question | 1.8 |
| Multiple Choice | 1.16 |
| Single Choice Set | 1.11 |
| Question Set | 1.20 |

Packages may contain local media in the supported image, audio, video and caption formats. Uploaded libraries stay in the scanned archive. Executable code comes from the standalone player and the exact dependencies listed in [the playback catalogue](library-catalogue.json). The portal transfers the bounded package data directly to a dedicated browser frame. Each launch uses a random HTTPS hostname on a separate site. The content runtime does not receive portal cookies or session tokens. Retain package attribution and verify that you have the rights to share the archive and its media.

## Deploy

1. Allocate a dedicated suffix such as `launch.h5p-content.example.net` on a different site from the portal. Provision wildcard DNS and a wildcard HTTPS certificate for that suffix. The content site serves the runtime without portal cookies, account routes, storage credentials or application code.
2. From this directory run `npm ci` and `npm run build`. The build checks the SHA-256 of each upstream release archive before unpacking its libraries. To build from prepared archives, set `LUMINOVIA_H5P_BUILD_ARCHIVE_DIRECTORY` to a directory containing `H5P.TrueFalse.h5p`, `H5P.MultiChoice.h5p`, `H5P.SingleChoiceSet.h5p` and `H5P.QuestionSet.h5p` with the digests in [build.mjs](build.mjs).
3. Run `node dist/serve.mjs` as an unprivileged service in the dedicated runtime environment. Set `LUMINOVIA_H5P_PORTAL_ORIGIN` to the approved HTTPS origin of this portal and `LUMINOVIA_H5P_CONTENT_HOST_SUFFIX` to the wildcard suffix. The backend listens only on loopback, on `LUMINOVIA_H5P_PORT` or the default port 6212. Terminate public TLS at the wildcard ingress. The [Caddy example](Caddyfile) uses the supplied certificate and private key paths and strips any incoming Cookie header.
4. Set `VITE_H5P_CONTENT_HOST` to the suffix before building the portal frontend. On the Hostinger or Academy ingress set `PORTAL_H5P_RUNTIME_DOMAIN` to the same suffix. The browser-facing frame policy permits HTTPS only for this additional site. Existing native H5P-to-question-bank import remains independently available.

Apply the portal migrations and start the existing file scanner before publishing. A new package requires a scan record for the exact version and digest. Withdrawal removes access through the course while preserving historical learner evidence.

## Local verification

- `npx --no-install vitest run src/features/learning/h5p-runtime-package.test.ts` checks exact ZIP selection, digest calculation, available libraries and input limits.
- `node scripts/course-h5p-playback-db-tests.mjs` uses an isolated PostgreSQL fixture and covers the internal edition and both Academy editions.
- With the built runtime and the directory of checksum-pinned archives, run `node scripts/h5p-runtime-browser-check.mjs` from the repository root. It opens the official samples on a loopback TLS proxy in actual Chromium on desktop and mobile viewports.
- The native course-workspace test uses a disposable portal, live scanner and dedicated loopback TLS runtime. Set `VITE_H5P_CONTENT_HOST` in the running portal and match it in `E2E_H5P_CONTENT_HOST`. Set `E2E_H5P_SAMPLE` to the True/False release archive. Launch the player with `PORTAL_TEST_MODE=1` and the loopback portal origin as `LUMINOVIA_H5P_PORTAL_ORIGIN`. Run Playwright with `--grep 'native workspace publishes, plays and withdraws'` against the disposable portal.
