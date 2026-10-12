# Google Maps configuration

Roam uses Maps JavaScript API with a cloud map ID and Advanced Marker photo pins. The browser key is returned by `/api/config`; protect it with website and API restrictions. Google Places is not enabled by this application.

1. Configure billing in your Google Cloud project and enable Maps JavaScript API.
2. Create a JavaScript map ID and attach a restrained cloud map style. Keep Google attribution visible.
3. Create a browser key restricted to Maps JavaScript API and your actual websites: `http://127.0.0.1:4180/*`, `http://localhost:4180/*` if used, and the final HTTPS origin when deployed. Do not allow arbitrary websites.
4. Set `GOOGLE_MAPS_API_KEY` and `GOOGLE_MAPS_MAP_ID` in the server environment, then restart Roam. Neither is bundled in source. The Windows launcher inherits its environment.
5. Configure conservative API quotas and budget notifications; monitor actual usage. Free allowances and prices depend on the billable SKU. Budget alerts are notifications, not spending caps.
6. Verify desktop/mobile photo markers, attribution, reuse between feed/expanded views and dragging a posting pin. Test an unavailable SDK and rejected credentials; load/render failures fall back to Leaflet/OpenStreetMap.

The discovery map is created once. The posting picker is created on demand and reused. Nominatim search and Wikipedia grounding continue unchanged. This machine has no configured Google key/map ID, so live Google behavior and usage remain unverified.

Sources: [Key restrictions](https://developers.google.com/maps/api-security-best-practices), [Maps JavaScript setup](https://developers.google.com/maps/documentation/javascript/cloud-setup), [Map IDs](https://developers.google.com/maps/documentation/javascript/map-ids/mapid-over), [Billing and usage](https://developers.google.com/maps/documentation/javascript/usage-and-billing), [Budget alerts](https://cloud.google.com/billing/docs/how-to/budgets).
