# Operations and verification

## Service configuration

Node 24+, npm ci, npm run build, npm run server. Defaults: loopback port 5187 and data/dungeon-architect.sqlite. GET /api/health checks availability. Set process variables from .env.example; the server does not auto-load that file.

For port 5227 in PowerShell:

```powershell
$env:PORT = '5227'
$env:ALLOWED_ORIGINS = 'http://127.0.0.1:5227'
npm run server
```

Use COOKIE_SECURE=true behind HTTPS, exact ALLOWED_ORIGINS, persistent DATABASE_PATH and the intended HOST. Keep SQLite on local storage for one server; independent replica databases do not share state. Public TLS, traffic policy, monitoring and hosting remain operator configuration. No public deployment was performed.

Grant an existing account a moderation role with npm run admin -- HANDLE moderator. Registration cannot choose roles. BLOCKED_TERMS overrides the comma-separated text-screening list; screening is basic and needs human moderation.

The Dockerfile/Compose package a non-root service and persistent volume. A local Docker build failed because npm registry connections inside this machine's Docker network returned ECONNREFUSED. Container deployment is prepared but not locally verified. Host builds/tests work.

Hashed assets use immutable cache headers; HTML/service worker revalidate; APIs use no-store. CDN hosting remains unconfigured.

## Backup and restore

npm run backup -- DESTINATION.sqlite uses SQLite's consistent live-backup API. Set DATABASE_PATH for a non-default source; source and destination must differ.

Stop the server before restoring. Preserve the current database and WAL/SHM companions together elsewhere. Place the backup at the configured path without old WAL/SHM beside it, then restart. Verify PRAGMA integrity_check and account/version retrieval before restoring traffic. The integration test verifies live backup, restart, sessions, immutable versions and reopening the backup independently.

Backups contain password hashes, sessions, private drafts and gameplay records. Restrict access. Production retention/erasure policies are not configured. Optional usage measurements are opt-in and distinct from operational/gameplay records.

## Automated evidence

Tests cover editor transactions/transforms, validation, deterministic v1/v2 replay, environments/logic/bosses, template bots, permissions, publishing/versioning, rewards, moderation, campaigns, shared conflicts, cosmetics, localization escaping and persistence. Browser flows cover desktop, mobile, 320 px layout, gestures, offline reload and two-account online play.

npm run benchmark seeds 10,000 dungeons and 100,000 attempts into an isolated database with ten samples per route. After adding a per-version completion index, measured medians on this workstation were 4.3 ms New, 39.2 ms Recommended, 190.7 ms global leaderboards and 0.8 ms recordings. These exclude production network/contention and are not capacity guarantees. npm run test:load sends 100 real HTTP requests at concurrency 10 to BASE_URL.

## Native verification

Java 21/API 36/Gradle 8.14.3 produced the Android debug APK. An API 36 x86_64 emulator installed and ran it. Native smoke completed the starter, published, simulated six adventurers, opened/seeked replay, and checked JavaScript errors/horizontal overflow. The narrow WebView issue it found is covered by regression tests.

For npm run test:native, launch a fresh QA starter profile and forward its debug WebView socket with adb to port 9331; WEBVIEW_URL overrides the CDP endpoint. Playwright noDefaults avoids unsupported WebView browser-context operations.

Set VITE_API_URL to an HTTPS host before native:sync for online native features. The current debug package has no public API configured. Custom scheme invitations are registered; verified HTTPS links require host association files. Native sign-in is process-scoped.

iOS sources and macOS simulator CI are present; Xcode has not run on this Windows machine. Signing, store submission, physical-device performance, device matrix/safe areas and controller support remain release work. Generated upstream Gradle flatDir warnings remain; application compilation is clean.

## External product evidence

60 FPS on supported mid-range phones, 5-10 minute onboarding, short sessions, enjoyable combat/construction, sustainable economy, recommendation/moderation quality and D1/D7/D30 retention need real device/player trials. Automated tests cannot establish these product goals.
