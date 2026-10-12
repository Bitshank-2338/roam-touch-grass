# Free Render staging, durable storage, then private GPU

Render staging is deployed at https://roam-bitshank.onrender.com. Connect services in this order: Render staging, Tiger Data plus private photo storage, then the GPU droplet.

## Connected Tiger Data staging (12 October 2026)

`roam-staging` is a Free shared service with 1 GiB in US East, PostgreSQL 18.6. Credentials are kept outside Git in the operator's private deployment directory and Render's private `DATABASE_URL`. Publishing remains disabled until private media is connected. Existing local memories have not been imported.

This free service presents a Timescale private CA chain. Set `PGSSLROOTCERT=/app/ops/tiger-ca.pem` on Render. The public CA was captured from the provisioned endpoint on first connection; its subject is `O=Timescale Inc, CN=ca.timescale.com`, SHA-256 `06:5A:75:0D:0D:64:F6:2D:AC:DC:97:9E:3B:83:D2:11:95:40:71:EA:59:B8:F3:40:7C:4E:87:CA:68:34:64:57`, expiry 20 October 2027. This is a trust-on-first-use pin, not an independently authenticated CA download. Subsequent connections verify the certificate chain and hostname; never disable verification. Obtain a replacement through a trusted provider channel before expiry or rotation. `PGSSLROOTCERT` supports an explicit operator-managed CA for other providers too.

## 1. Render staging

Deploy the `render.yaml` blueprint from this application directory (set the service root if the repository contains other projects). The blueprint uses Free compute, no disk, and `PUBLIC_POSTING_ENABLED=0`. Reuse the existing local `data/summary-provenance.key` as `ROAM_PROVENANCE_KEY` in Render Secrets (encode its 32 bytes as 64 hexadecimal characters). This preserves existing signed context during migration. For an entirely new empty installation only, generate a fresh stable key. `ROAM_MODERATOR_KEY` is generated once by the blueprint. Neither key belongs in browser configuration or Git. Keep both across deployments and include them in secure operational backups.

The site binds to Render's port with one trusted proxy hop. `/healthz` checks the website process. Preview rejects contribution/identity/moderation mutations. Render may sleep after 15 idle minutes; trend catch-up occurs on waking, rather than promising continuous daily execution.

## 2. Tiger Data and private photos

Configure `DATABASE_URL` with the Tiger Data PostgreSQL connection string. External connections require certificate-verified TLS; test-only exceptions apply only to the named disposable Docker database. Set `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `S3_FORCE_PATH_STYLE` for the chosen S3-compatible provider. The bucket must be private. Roam proxies media through owner/moderator or approved-public checks; object keys never grant access themselves. No browser receives bucket credentials.

Before moving existing data, pause posting, make and restore-test a private backup, and run `node ops/migrate-storage.mjs <source-data-directory> --dry-run`. With target credentials set in the operator environment, run the same command without `--dry-run`. The target must be a dedicated empty database. IDs, ownership hashes, approved versions, reviews, trends and usage ledgers are preserved. Media is transferred before database commit. Interrupted transfers may leave private orphan objects; no imported posts commit on failure. Re-running against a populated destination is rejected.

Run the deployment retention and recovery checks before setting `PUBLIC_POSTING_ENABLED=1`. Production startup rejects publishing without the database, bucket and stable moderator/provenance keys. Until ShieldGemma is validated, contributions require manual review.

## 3. Private GPU

Install Ollama with `gemma3:4b` and the documented ShieldGemma scorer. Both underlying services must bind to loopback. Start `ops/ai-gateway.mjs` with a strong `ROAM_AI_GATEWAY_KEY` (at least 32 characters) and put an HTTPS reverse proxy in front of port 4192. The gateway requires the bearer key, exposes only chat/tags and policy health/classify, restricts the Gemma model, bounds requests/responses and fails closed on malformed or unavailable services. Set the same gateway URL for `OLLAMA_URL` and `SHIELDGEMMA_URL`, and its key for both Render service-key variables. If the scorer uses a separate internal key, configure it on the gateway machine.

Do not expose Ollama 11434, policy port 4191 or model-management routes publicly. Evaluate labelled moderation cases before changing `SHIELDGEMMA_VALIDATED=1`. See `shieldgemma.md`. GPU and model feasibility remains an actual-machine acceptance check.

## Backups and release acceptance

`python ops/backup-data.py backup <source> <new-backup-directory>` creates a consistent SQLite backup, referenced photos and filesystem keys with checksums. `restore <backup> <new-data-directory>` verifies integrity/checksums and refuses overwrites. Pause posting for final migration; immutable photos can still be deleted during a live backup, in which case backup fails explicitly.

For PostgreSQL, keep off-machine `pg_dump` backups and bucket inventory/version backups. Restore into a new database and private bucket; validate row counts, hashes, ownership, published snapshots and photo readability. Environment-held keys require separate secure backup. The migration integration test exercises data preservation, but is not evidence that a future provider's backup service has been tested.

Verify HTTPS/location permissions, recovery, photos after redeploy, moderation failures and playback on an actual phone before public sharing. Never present missing GPU validation, Figma repairs or physical-device checks as completed.

References: [Render free hosting](https://render.com/docs/free), [node-postgres TLS](https://node-postgres.com/features/ssl).
