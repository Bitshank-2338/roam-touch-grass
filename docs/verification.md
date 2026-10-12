# Verification record — 12 October 2026

## Passed

- Windows Node 24.14: 54 tests and all syntax checks passed.
- Production Node Docker image built successfully; Linux verification container passed the full suite with PostgreSQL and private MinIO media enabled (54 tests). Earlier SQLite/container and PostgreSQL-only runs also passed.
- Four PostgreSQL store contract checks passed: anonymous recovery after reopen, stale moderation revisions, approved edit snapshots, unique reactions, private comments and cascading deletion.
- Four PostgreSQL/MinIO integration checks passed: concurrent decisions/reactions, private object access (anonymous GET returns 403), failed put/removal, SQLite-to-PostgreSQL/media migration preserving hashes/IDs/snapshots/budgets, refusal to overwrite a populated target and grounded trend invalidation.
- SQLite WAL backup/restore passed, including referenced photos and signing keys, checksum tamper detection and refusal to overwrite a destination.
- PostgreSQL pg_dump/pg_restore into a new disposable database passed hashes across all eight application tables.
- AI gateway tests passed: missing key denied, model-management routes denied, wrong model denied, credentials forwarded only to the intended service, malformed data/upstream failure/timeouts fail closed.
- Live Geoapify nearby discovery returned named parks, museums and restaurants. Existing provider search, tile, route and walking-budget tests passed.
- Live Gemma 3 4B produced the Misu sourced overview (mapped restaurant/cuisine) with explicit missing-Wikipedia limitations; no fabricated history or reviews. A real Cubbon Park planning request returned a 60-minute plan within a 120-minute budget and retained example-memory warnings.
- Desktop and 390px mobile place detail were inspected; one overview, readable source link, address, missing-data warnings and listen/map actions. Mobile document width matched viewport width. Feed/navigation and read-only preview boot were checked in the browser.
- Listen changed to Stop, and Stop cancelled playback. The user separately confirmed audible summaries and working microphone capture on their intended device.
- Staging serves the application while blocking contribution/identity/moderation mutations; the browser skips device creation and displays preview state.
- Original localhost:4180 restarted after a private backup. Health is OK, Geoapify is configured, local posting is enabled and automatic moderation remains disabled. Existing memory counts match the backup.

## Still conditional / blocked

- Actual ShieldGemma weights/runtime/evaluation: model access and download authentication are verified, but models are not installed or evaluated on the future GPU machine. Contract tests use controlled policy-service responses. The automatic approval gate remains closed.
- Figma: Starter MCP quota again rejected access. Existing editable screens still need their saved layout/brand repairs and fidelity checks; local screenshots do not establish Figma completion.
- Render and Tiger Data are connected. Verified HTTPS, health, search, certificate-verified database TLS and database usage/trend retention across a Render redeploy. Private object storage and GPU inference are not connected; those provider-specific checks remain pending.
- Free Render cannot guarantee execution precisely at 06:00 IST while asleep; persisted trends catch up when the process wakes.

## Reproduction

Use `npm test`, `npm run check`, `npm run test:pg-contract`, `npm run test:storage`, and `npm run test:postgres:s3`. PostgreSQL/storage runners only accept the disposable local `roamtest` database. `compose.test.yaml` creates the test dependencies. This Windows run used Docker inside WSL, an official-source build of MinIO, and `ops/Dockerfile.verify` to supply Python for restore testing. Production images do not need Python to serve Roam.

Source delivery excludes `.env`, databases, photos/quarantine, backups, model caches, authentication tokens, logs and private evaluation material.

## Render staging — 12 October 2026

Free Docker service `roam-bitshank` is deployed in Singapore from private repository `Bitshank-2338/roam`. HTTPS, health, Geoapify PNG tiles and place search passed; posting/identity mutations return 503, policy auto-approval is disabled, and the public configuration does not expose the geographic key. Live browser validation found and corrected a private-memories fetch during read-only boot. Tiger Data was subsequently connected with certificate-verified TLS; eight application tables are ready and usage/trend records survived a second Render redeploy. Private photos and GPU remain unconnected.
