# ZirZirCord

Voice, video, screen sharing and chat organised around **sessions** instead of servers.

- **Sessions + codes.** Create a session and share its code (`ABCD-EFGH`). Others join with the code only. Nobody sees anyone's email or IP address.
- **Host.** The host is the member who has been present the longest (👑). When the host leaves, the next-oldest member becomes host. A session closes only when everyone has left.
- **Set sessions.** These are permanent sessions. Everyone who has visited one sees it on Home. Clicking it starts hosting it, or joins if someone is already there. History is kept.
- **Owner controls.** The owner (and moderators they appoint by unique ID, `ZZ-XXXXXX`) can:
  - allow or deny member creation of text and voice channels
  - kick, ban or unban from the session or from a single channel
  - server-mute in voice
  - rotate the invite code
  - transfer ownership

  The host has no special powers.
- **Features.** Text chat, images, video, files, voice messages, profiles, voice channels, camera, and screen share with sound.
- **Platforms.** Web, desktop (Windows / macOS / Linux) and mobile (Android / iOS).

## Architecture

```
packages/shared        Types, validation schemas, socket events, permission matrix (used everywhere)
packages/client-core   API client, realtime socket, app store, LiveKit call manager (web + desktop + mobile)
apps/server            Fastify + Socket.IO + PostgreSQL (Prisma) + Redis + S3 storage + LiveKit
apps/web               React 19 + Vite + Tailwind (also the UI of the desktop app)
apps/desktop           Electron: screen/window picker, system-audio share, global push-to-talk, tray, deep links
apps/mobile            Expo / React Native app (standalone install, shares packages/* via Metro)
infra/                 LiveKit, storage and production deployment configs
```

### Why voice and screen share sound clean

The old prototype sent raw PCM audio over UDP. It had no jitter buffer, no loss recovery and no bandwidth adaptation, which caused the buzzing and stutter. ZirZirCord sends all media through a **LiveKit SFU** (selective forwarding unit) over WebRTC:

- **Opus 48 kHz with RED** (redundant audio) and DTX. A lost packet is recovered from the next one instead of crackling. Each channel picks a preset: Voice 64k, High 96k, or Music 128k stereo.
- **WebRTC jitter buffer and loss concealment** on every client.
- **Optional AI noise suppression** (RNNoise) on web and desktop, in addition to the standard echo cancellation, noise suppression and AGC.
- **Screen share** uses VP9 SVC with a VP8 fallback, presets from 720p30 to 4K, and a "text vs motion" optimisation.
- **Large calls.** The SFU forwards packets without mixing or transcoding. *Adaptive stream* sends each viewer only the resolution they display. *Dynacast* pauses video layers nobody watches.
- **Measured in the end-to-end test** (two headless Chrome clients through the local SFU): 0 packets lost, 0–1 ms jitter, 0 concealed audio samples.

## Running it locally

Requirements: Node 22+, Docker Desktop.

```bash
npm install                 # installs server, web, desktop and shared packages
npm run infra:up            # Postgres, Redis, SeaweedFS (S3), LiveKit
npm run db:migrate          # creates the database tables
npm run dev                 # API on :4000 + web app on :5173
```

Open http://localhost:5173 in two browsers (or one normal and one private window) and continue as guests.

**Desktop app (dev):** with `npm run dev` running, run `npm run dev:desktop`.

**Tests:**

```bash
npm test -w @zirzircord/shared     # codes + permission matrix
npm test -w @zirzircord/server     # session lifecycle, host handover, set sessions, bans, uploads (needs infra:up)
```

### Testing from phones on your Wi-Fi

`localhost` on a phone is the phone itself, so:

1. Set `LIVEKIT_NODE_IP=<your Mac's LAN IP>` `STORAGE_BIND=0.0.0.0` and `LIVEKIT_BIND=0.0.0.0` in `.env`, then `docker compose up -d livekit storage`. (Both only listen on localhost by default; remove these again when you are done.)
2. Set `LIVEKIT_URL=ws://<LAN IP>:7880`, `S3_PUBLIC_ENDPOINT=http://<LAN IP>:9000`, `PUBLIC_API_URL=http://<LAN IP>:4000`, and add `http://<LAN IP>:5173` to `CORS_ORIGINS`.
3. Web: open `http://<LAN IP>:5173`. Browsers only allow the microphone over HTTPS or localhost, so for real phone tests use the mobile app or deploy with HTTPS.
4. Mobile app: on the sign-in screen, tap **Server** and enter `http://<LAN IP>:4000`. Android only allows plain `http://` in builds made with `EXPO_PUBLIC_ALLOW_HTTP=1` (or `EXPO_PUBLIC_API_URL=http://…`); release builds are HTTPS-only.

## Mobile app (Expo)

```bash
cd apps/mobile
npm install
npx expo prebuild          # generates the native android/ and ios/ projects
npx expo run:android       # or: npx expo run:ios
```

It must run as a **development build**. Expo Go can't load WebRTC.

| Feature | Android | iOS |
|---|---|---|
| Chat, files, photos, voice messages, profiles, moderation | ✅ | ✅ |
| Voice, camera, watching screen shares | ✅ | ✅ |
| Sharing your own screen | ✅ (MediaProjection, set up by `plugins/withScreenShare.js`) | ⚠️ needs a Broadcast Upload Extension target (see below) |

**iOS screen sharing** needs an extra Xcode target (Broadcast Upload Extension) that shares an App Group with the app. Follow LiveKit's guide "React Native → Screen share → iOS" and add the extension in `ios/` after `expo prebuild`.

## Desktop app

```bash
npm run dist:mac   -w @zirzircord/desktop    # .dmg
npm run dist:win   -w @zirzircord/desktop    # .exe installer (build on Windows, or use CI)
npm run dist:linux -w @zirzircord/desktop    # AppImage + .deb
```

- The desktop app talks to `http://localhost:4000` by default. For a release, build the web app with `VITE_API_URL=https://api.your-domain` (`VITE_API_URL=... npm run dist:mac -w @zirzircord/desktop`).
- **macOS:** global push-to-talk asks for **Accessibility** permission. Screen sharing asks for **Screen Recording** permission. Builds are unsigned until you add an Apple Developer certificate.
- **System audio** in screen share works on Windows and macOS 13+. On Linux, only the screen is shared.

## Going live from this computer (Supabase + LiveKit Cloud + Vercel + Cloudflare Tunnel)

No server needed. Database and files are on **Supabase**, voice is on **LiveKit Cloud**, and the website is on **Vercel**. The API runs on your computer and is reachable through a free **Cloudflare quick tunnel**.

1. Fill in `infra/.env.cloud` (template: `infra/.env.cloud.example`).
2. `brew install cloudflared`, then sign in to Vercel once with `npx vercel@latest login`.
3. Run `npm run live`.

The command starts Redis, the API and the tunnel, then rebuilds and redeploys the website to Vercel pointing at the tunnel. The site stays online while it runs and the computer is awake. The tunnel address changes on each restart, which is why the command redeploys the website every time. Voice occupancy is polled from LiveKit, so no webhook setup is needed.

For an always-on setup, use Railway (below), run the same Docker image (`apps/server/Dockerfile`) on Render/a VPS with the same variables, or use a named Cloudflare Tunnel on your own domain.

## Always-on API for free on Oracle Cloud (Supabase + LiveKit Cloud + Vercel)

The API, Redis and Caddy (automatic HTTPS) run with Docker on an Oracle Cloud **Always Free** VM. The VM can be `VM.Standard.E2.1.Micro` (1 GB) or Ampere A1. The website stays on Vercel.

**Requirements on the computer you deploy from:** Node 22+, Docker Desktop (running), `infra/.env.cloud` filled in, and an SSH key that the server accepts.

**One-time server setup** (Ubuntu 24.04):

- Add 2 GB of swap.
- Open TCP 80 and 443 in two places: the subnet's security list, and the VM's own iptables (`/etc/iptables/rules.v4`).
- Install Docker: `sudo apt install docker.io docker-compose-v2`.

**Deploy or update the API:**

```bash
npm run deploy:api -- --host=ubuntu@<public-ip>   # first time; the host is remembered in .live/
npm run deploy:api                                # later deploys
```

The script does the following:

1. Builds the image locally for `linux/amd64`. Pass `--platform=linux/arm64` for an A1 VM.
2. Streams the image to the VM over SSH and uploads `infra/oracle/`.
3. Writes the server's `.env` from `infra/.env.cloud`.
4. Starts everything and waits for `https://<ip-with-dashes>.sslip.io/health` to respond. sslip.io is a free hostname; set `API_DOMAIN` in `infra/.env.cloud` to use your own.

**Then point the website at the API:**

```bash
npm install
npm run deploy:web -- --api-url=https://<ip-with-dashes>.sslip.io
```

## Always-on API on Railway (Supabase + LiveKit Cloud + Vercel)

The API runs on Railway, so the site no longer depends on your computer. `railway.json` already tells Railway to build `apps/server/Dockerfile`, check `/health`, and run one instance. Database migrations run when the container starts.

1. On [railway.com](https://railway.com): **New Project → Deploy from GitHub repo** and pick this repository.
2. In the same project: **+ Create → Database → Redis**.
3. Open the API service → **Settings → Networking → Generate Domain**. You get an address like `https://zirzircord-api.up.railway.app`.
4. Open the API service → **Variables** and add these. Use the same values as `infra/.env.cloud`:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Supabase session pooler URL (port 5432) |
   | `REDIS_URL` | `${{Redis.REDIS_URL}}` (Railway fills it in) |
   | `JWT_SECRET` | the same value as before, so users stay signed in (`openssl rand -hex 48` for a new one) |
   | `CORS_ORIGINS` | `https://zirzircord.vercel.app,http://localhost:5173,http://localhost:14320` |
   | `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT` | the Supabase S3 endpoint (both the same) |
   | `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | from Supabase |
   | `S3_BUCKET` | `zirzircord` |
   | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | from LiveKit Cloud |

   You don't need to set `PORT` or `PUBLIC_API_URL`. Railway sets `PORT`, and the API builds `PUBLIC_API_URL` from the generated domain. If you add a custom domain, set `PUBLIC_API_URL` to it.
5. Once the deploy is healthy, point the website at it:
   ```bash
   npm run deploy:web -- --api-url=https://zirzircord-api.up.railway.app
   ```
   Run the same command again whenever you change the website.

From now on, every push to `main` redeploys the API automatically. Mobile app: tap **Server** on the sign-in screen and enter the Railway address.

## Deploying to a VPS

1. Point four DNS names at the server: app, `api.`, `lk.` (LiveKit) and `files.` (uploads).
2. Open ports **80, 443** (TCP+UDP), **7881/tcp**, **3478/udp** and **50000–50200/udp**.
3. Configure:
   ```bash
   cp infra/.env.prod.example infra/.env.prod                         # fill in domains + secrets (openssl rand -hex 32)
   cp infra/seaweed-s3.prod.json.example infra/seaweed-s3.prod.json   # same S3 key/secret as .env.prod
   ```
4. Start:
   ```bash
   docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build
   ```

Caddy obtains HTTPS certificates automatically. Database migrations run when the server container starts.

Voice quality depends on the server's bandwidth. Each listener receives every active speaker (~64–128 kbps each). Each screen-share viewer receives one stream (up to ~6–12 Mbps at 1080p60/4K). To use LiveKit Cloud instead of self-hosting media, set `LIVEKIT_URL/KEY/SECRET` to your LiveKit Cloud project and remove the `livekit` service.

## Known limits and next steps

- **Single API instance.** Presence grace timers are in-process. Running several API replicas needs a shared job queue (e.g. BullMQ) and the Socket.IO Redis adapter.
- **iOS screen sharing** needs the Broadcast Upload Extension described above.
- **Android background calls.** A call keeps running while you switch apps briefly, but a long background call needs a foreground-service notification (e.g. with Notifee).
- **Not built yet:** friends/DMs, push notifications, message search, end-to-end encryption.

## Abuse protection

- **App-only API.** Requests from any website not listed in `CORS_ORIGINS` are refused, and requests without a web origin must come from the official apps (they send an `X-ZZ-Client` header). This stops other sites and casual scripts. It can't stop someone who copies the header and uses their own login token: that is what the limits below are for. Older phone or Electron builds don't send the header yet; set `CLIENT_CHECK=log` on the server to let them in until everyone has updated.
- **Spam timeouts.** Each user can send 5 messages per 5 s in a session (15 per 10 s across sessions). Going over times them out automatically for 1 min, then 5 min, then 15 min (strikes reset after an hour). Owners and mods can also time a member out by hand from their profile. Timed-out members can read but not write or react.
- **Sleeping set sessions.** A set session nobody has opened or written in for 5 days falls asleep (💤). Opening it wakes it. After 30 days asleep it is deleted with its messages and files; members see a countdown in the last 7 days. Tune with `SESSION_SLEEP_DAYS` and `SESSION_DELETE_AFTER_SLEEP_DAYS`.

## Desktop app (Tauri)

`apps/desktop-tauri` is the lightweight desktop shell (system WebView, no bundled Chromium).
The older Electron shell in `apps/desktop` is kept for now.

- **Develop:** `npm run dev:tauri` (starts the web dev server; the API must run on `localhost:4000`).
- **Build locally:** `npm run dist:tauri:mac` / `npm run dist:tauri:win` on that OS. Set `VITE_API_URL` to the API you want baked in.
- **Test voice with the bundled `.app`, not the bare binary:** macOS only exposes the microphone to an app bundle with an `Info.plist`.
- **API CORS:** `CORS_ORIGINS` must include `http://localhost:14320` (the app serves its UI from there; `scripts/deploy-api.mjs` already does).
- **Releases:** push a tag `desktop-v<version>` (matching `apps/desktop-tauri/src-tauri/tauri.conf.json`). `.github/workflows/desktop-release.yml` builds `.dmg` (Apple Silicon + Intel), Windows `.exe`, Linux `.AppImage`/`.deb` and attaches them to a draft GitHub Release; publish the draft to ship it. Installed apps check the latest release for updates on startup.
- **One-time repo setup:** secret `TAURI_SIGNING_PRIVATE_KEY` (content of `~/.tauri/zirzircord.key`, the updater signing key — keep it safe, losing it breaks updates), optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and variable `VITE_API_URL`.
- Builds are not code-signed: on macOS right-click → Open the first time; on Windows SmartScreen → More info → Run anyway. Voice calls on Linux (WebKitGTK) are experimental, and screen sharing is not available in this shell yet.
