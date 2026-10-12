# Geoapify in Roam

One private `GEOAPIFY_API_KEY` powers maps, geocoding, nearby places and walking routes. Start normally with `npm start`; the server entrypoint loads `.env` using Node's native environment-file support. Existing process environment variables take precedence. Tests import the server without loading the local file. The key is never returned by `/api/config`, embedded in a browser URL or included in source archives. All Geoapify requests use fixed upstream hosts/paths through the backend; this is not an arbitrary URL proxy.

## Configuration

Create a free Geoapify project and put `GEOAPIFY_API_KEY=...` in the ignored local `.env`. For this single-key server setup, browser HTTP referrer/origin restrictions are inappropriate. Keep the key private and restrict outgoing server IP when stable. Never mistake CORS settings for access control. Restart Roam after changing the file. No Google billing or map ID is needed while Geoapify is active.

Geoapify is the primary provider when configured. Without it, the existing Google configuration or Leaflet/OSM path remains. The Positron raster map uses our current photo markers. A tile error replaces the tile layer with OSM and updates the provider note. Search errors are explicit and manual pin selection stays available. Required Geoapify/OpenMapTiles/OSM attribution remains visible.

## User flows and interfaces

- `/api/search?q=...` retains the existing result array and `{label,lat,lng}` fields, adding place ID, name, area and categories. It uses Geoapify Forward Geocoding when configured; otherwise the existing manual Nominatim search remains.
- `/api/maps/tiles/:z/:x/:y.png` accepts valid integer XYZ tiles through zoom 20 and proxies only Positron PNG tiles. It cannot accept upstream URLs, styles or client keys.
- `/api/nearby-places?lat=...&lng=...&category=all` returns `{provider,places,attribution}` for at most ten parks/caf√©s/attractions within 3 km. Optional categories: Outdoors, Food, Culture. The discovery button is user initiated and available beside the map on desktop/mobile. Results are clearly map-data suggestions, separate from community memories and trends; selecting one displays a distinct marker.
- `/api/route` accepts `{postIds:[...]}` for two to four distinct published memories within 50 km of the first stop. It returns walking minutes, distance, sanitized GeoJSON and attribution. Pending/deleted posts and arbitrary waypoints are rejected.
- `/api/plan` adds `route`, `travelMinutes` and `totalTripMinutes`. Optional memory stops are removed until visits plus walking fit the budget. Source IDs remain fixed before Gemma writes advice. If routing fails, no old route is reused and the UI explicitly labels travel as extra. Walking estimates exclude travel to the first stop, return travel and delays. Route geometry can be displayed on the map and its distance/time appear in downloaded plans.

Nearby provider results are never represented as verified visits, live workshop availability or Roam trending contributions. Wikipedia summary provenance and pre-publication checks continue independently.

## Usage and privacy

The backend caches successful tiles for one hour and JSON for five minutes, coalesces identical in-flight requests, bounds memory at 512 entries/32 MB and spaces upstream starts by 250 ms. Endpoint limits, fixed nearby radius/limit, bounded routes and a maximum queue protect the private proxy. Failed upstream text/URLs are never forwarded or logged with the key.

A SQLite ledger reserves estimated credits before requests: 0.25 per tile, 1 per geocode/nearby call and one per routing waypoint pair. Roam stops new upstream calls at 2,400 estimated credits per UTC day; cached data remains usable. Failed calls are counted conservatively. This ledger survives a restart in the same data directory. It is an application budget, not Geoapify billing authority or a quota shared across other applications/keys/data directories. Monitor the Geoapify dashboard; multiple server instances should share a centrally coordinated budget before production use.

Geoapify receives requested map areas, search text, a requested nearby map center and coordinates of selected public itinerary stops, through this server. No voice transcript, media or private browser identity is sent. Wikipedia remains the source for checked summary facts. Update retention/privacy documentation before public launch.

## OpenAPI workflow and checks

Integration was built with Codex using the official [OpenAPI catalog](https://apidocs.geoapify.com/open-api/), Forward Geocoding 1.1.1 contract and current API documentation. Contracts inspected: Map Tiles 1.1.0, Places 2.2.0 and Routing 1.2.0. Corrections included preserving GeoJSON longitude/latitude order, keeping a single key server-side, translating current categories, accounting for walking time in the budget and invalidating a previous route after a subsequent failure. No Geoapify MCP connection or program application was submitted.

`npm run check` and `npm test` cover caching/coalescing, normalized results, invalid tiles/coordinates, private failure messages, persistent budget, route geometry and total-budget fitting. Live API checks with the configured key succeeded for search, nearby places, PNG tiles and walking routes. Browser QA checks desktop/mobile map attribution, search/discovery and Gemma plan route controls. A controlled browser network block of the local tile endpoint verified that the map switches to OSM with an explicit fallback note. Removing the block and reloading restored Geoapify. Invalid-key/transport failures are covered by isolated tests; the saved credential was not changed to induce failure.

The old 4180 process could not be stopped because command review rejected that action. A separate preview at http://127.0.0.1:4190 uses `data/geo-preview` with example memories and the same geographic key, preserving the original runtime data. Restart the original app normally to activate this source against its original data.

References: [Key protection](https://myprojects.geoapify.com/help/api-keys/), [Tiles](https://apidocs.geoapify.com/docs/maps/map-tiles/), [Geocoding](https://apidocs.geoapify.com/docs/geocoding/), [Places](https://apidocs.geoapify.com/docs/places/), [Routing](https://apidocs.geoapify.com/docs/routing/), [Credit costs](https://www.geoapify.com/pricing-details/).

## Nearby discovery improvements

Nearby discovery requests named venues only, excludes highway features and unnamed address fallbacks, deduplicates IDs, and mixes outdoors, culture and food in the All view. Separate category searches prevent nearby restaurants from hiding parks and museums. All uses three cached Places requests (up to 20 results per category); a specific category uses one. Each result has a sourced map overview, straight-line distance and address. Selecting a result opens details and checks an exact place/city Wikipedia reference. Checked source sentences appear verbatim with links; unmatched references are disclosed. Only approved non-demo memories with a matching name and a pin within 500 m are linked. The Listen action reads this same content using the existing on-device speech player. No AI-written venue facts, popularity ratings or current opening times are invented. Restart the original server and hard-refresh to activate the new API.

## Gemma place research

Opening a nearby place now requests Geoapify Place Details for its discovered ID using the existing private key. The returned details must match the original pin and identity (canonicalized provider IDs are accepted only for a matching details name and pin). Only explicit source fields are used: description, cuisine, opening hours, reservations, accessibility, facilities and website. Linked Wikidata entities must have coordinates within 1 km before their English description, inception year and English Wikipedia sitelink are used. Wikipedia titles still pass the existing place/city matching check. Arbitrary websites are linked, never fetched.

Gemma selects 4ñ6 distinct fact identifiers where enough evidence exists; displayed sentences remain source-derived and carry source IDs. Sparse places stay shorter. Invalid model output and Ollama outages fall back to retrieved facts. Approved non-demo Roam memories can contribute clearly attributed personal accounts. Public response adds checkedAt, website, mode, model, warnings and limitations while retaining facts/reference/memories. Sources carry licensing labels (OSM ODbL, Wikidata CC0 and Wikipedia source terms). Details and AI selections cache for five minutes with concurrent request coalescing and a bounded cache. Keys and raw provider responses remain private.
