# Anonymous social API

All mutation requests use the same origin. The API retains per-IP limits and adds a private random browser key, issued by `POST /api/device` (`201 {deviceKey,deviceId}`) and sent in `X-Roam-Device`. Only its SHA-256 hash is stored server-side. `GET /api/device` validates a recovered key. `POST /api/device/adopt` accepts `{posts:[{id,editToken}]}` to claim earlier posts with valid private per-post editing keys. Recovery must retain both the browser key and legacy per-post keys. The browser key provides continuity, not a verified human identity.

## Memories and interactions

- `GET /api/posts`: approved public snapshots only, with `status:Published`, `heartCount`, `commentCount` and caller-specific `liked`. No private proof, key or browser identifier is exposed.
- `GET /api/my-posts`: requires the browser key; returns complete latest drafts with `status`, `reviewReason`, `published`, `revision`, `provenanceToken` and owner `privateMedia`. It includes blocked, pending and reviewed submissions.
- `POST /api/posts`: multipart photo/text, requires a private browser key plus the existing `X-Roam-Location` receipt. Returns `202 {post,editToken,status:Checking}`. New photo uploads allow JPG/PNG/WebP up to 15 MB, decode and strip metadata, and enter quarantine. Video uploads are rejected before any model work.
- `PATCH /api/posts/:id`: requires the owning browser key or legacy Bearer edit token; returns 202 latest draft. The prior approved snapshot remains public while the edit is checked. A revision guard prevents a delayed model result from approving a newer edited body.
- `DELETE /api/posts/:id`: same ownership; removes memory, media, reports, hearts and comments and immediately invalidates trends.
- `PUT /api/posts/:id/heart {liked:boolean}`: browser key required; a database primary key enforces one heart per browser/post. Returns `{liked,heartCount}`.
- `GET /api/posts/:id/comments`: returns `{comments,mine}`. Only published comments are public; `mine` includes the caller's non-public states. Each record has `id,postId,text,alias,created,status,reviewReason,canDelete`.
- `POST /api/posts/:id/comments {text,alias}`: browser key required; 1–1500 text characters, alias up to 40. Returns `202 {comment,status:Checking}`.
- `DELETE /api/comments/:id`: only the owning browser key may delete.

`/uploads/:filename` serves a file only if an approved public snapshot references it. `/api/private-media/:filename` requires an owner browser key, that post's editing Bearer token or the moderator Bearer key. Fetch private previews with headers and create a temporary blob URL; keys must never appear in a query string. Both routes set `Cache-Control:no-store` so blocked media is not deliberately cached by Roam.

## Review, maps and trends

`GET /api/moderation` and `POST /api/moderation/:kind/:id {status,reason}` require `Authorization:Bearer <moderator-key>`. Kinds are `post` and `comment`; decisions are `Published`, `Blocked`, `Needs review`. Blocking a post manually removes its public snapshot. Publishing resolves its reports. The key comes from `ROAM_MODERATOR_KEY` or the private generated `DATA_DIR/moderator-key.txt`; `/moderator` is the operator interface. Decisions are audited in SQLite.

`GET /api/config` returns browser Maps configuration and safe screening readiness. Google activates only with both `GOOGLE_MAPS_API_KEY` and `GOOGLE_MAPS_MAP_ID`. The key must be restricted to intended browser origins and Maps JavaScript API; the Node server does not create projects, billing or keys. Leaflet is the fallback. No moderator/service secrets appear here.

`GET /api/trending` returns `{heading,mode,places,updatedAt,stale,nextRefresh}`. Each place includes fixed `place,area,lat,lng,score,sourceIds,latest,explanation` and optional `explanationSourceIds`. Approved non-demo memories from the last seven days count at most once per browser/place/local day, with duplicate normalized captions excluded and exponential three-day recency weighting. Each trending place needs three contributions from two browser identities; otherwise the heading is **Recently shared**. Rankings never come from model text. Gemma selects real evidence IDs and an existing topic; the app quotes the selected memory title. Reported memories are excluded pending moderator resolution.

Snapshots refresh at 06:00 Asia/Kolkata (00:30 UTC), catching up once after startup. Posting checks and foreground AI tasks have queue priority over trends. The SQLite queue survives restarts; no external scheduler or model service is started automatically. Continuous daily work needs Roam to remain running. Dirty snapshots immediately rerank current permitted evidence without reusing stale explanations.

## Staging and deployment adapters

`GET /api/config` includes `features.publicPosting`. A false value means preview browsing only: device creation and contribution/comment/moderation mutations return 503 with a sharing-unavailable message. Browser controls display preview state and skip identity creation.

`GET /api/moderation/status` requires the moderator key and reports policy readiness. `POST /api/moderation/:kind/:id/recheck` requires validated policy readiness and moves Needs review/Blocked items back to Checking with a new revision. Both posts and comments reject stale decisions.

Database and media adapters preserve public response shapes. PostgreSQL operations are asynchronous; external TLS certificates are verified. S3 media stays in a private quarantine namespace and is served through existing authorization routes. `/healthz` reports website process availability, not AI readiness.
