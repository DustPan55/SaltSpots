# Salt Spots — Native iOS (SwiftUI) Port Spec

This is the build spec for rebuilding the Salt Spots web app (`index.html`) as a **native SwiftUI app**. It captures the exact scoring math, data models, API contracts, and edge-function interfaces so a fresh Claude session on a Mac can build straight from here without re-reading the 2,000-line HTML.

**The web app stays live and untouched** (deployed via GitHub Actions to `dustpan55.github.io/SaltSpots`). The Swift app is a parallel client on the **same Supabase backend and same edge functions** — nothing server-side changes.

## Decisions (locked)
- **Min target: iOS 17+** — use SwiftData, Swift Charts, SwiftUI `Map` (MapKit), Observation.
- **v1 scope: core app first** — Map, Today, Plan, Catches, Spots, charts, sync, AI, lure vision. **Widget + Apple Watch come after** as extensions (they read the same Supabase data).
- **Bundle ID: TBD tomorrow** (possible rebrand). Placeholder: `com.dustpan.saltspots`. App display name TBD.
- **Language/UI: Swift 5.9+/SwiftUI**, async/await networking, `Codable` models.

---

## 1. App structure (mirrors the web tabs)

`TabView` with 5 tabs; sheets presented with `.sheet`.

| Tab | Screen | Content |
|---|---|---|
| Map | `MapScreen` | MapKit `Map`, scored spot pins, center crosshair + "add spot" button, Layers menu (satellite/habitat/depth/imagery overlays) |
| Spots | `SpotsScreen` | list of saved spots sorted by live score; tap → detail sheet |
| Catches | `CatchesScreen` | catch log, stats, "AI pattern finder" button |
| Plan | `PlanScreen` | 7-day outlook, on-water hours, tap a day → ranked spot itinerary + AI trip plan |
| Today | `TodayScreen` | moon, now-score, tide/wind/temp charts, best windows, 7-day outlook |

Header (persistent, above tabs or in Today): live chips **Tide / Water°F / Wind / Bite**, each tappable → forecast sheet. Gear → Settings.

Sheets: SpotDetail, SpotEdit, LogCatch, Settings, Forecast (tide/wind/temp/bite segmented).

---

## 2. Data models

```swift
struct Spot: Identifiable, Codable {
    var id: String                 // UUID string
    var name: String
    var structure: StructureKind   // enum below
    var species: [String]
    var notes: String?
    var lat: Double
    var lng: Double
    // transient: score, habitat tags, bottom structure (cached, not synced)
}

struct Catch: Identifiable, Codable {
    var id: String
    var kind: CatchKind            // .catch | .blank  (blank = fished, caught nothing)
    var spotId: String?
    var spotName: String?
    var lat: Double?
    var lng: Double?
    var species: String?
    var count: Int?
    var lengthIn: Double?
    var bait: String?
    var notes: String?
    var structure: String?
    var conditions: Conditions?    // snapshot at catch time (see §5) — INCLUDES `factors` for calibration
    var caughtAt: Date
}
```

`Conditions` = the scoring context snapshot at the time/place: water temp, wind, wind dir, gust, pressure + trends, tide state, moon, cloud, wind tide, streamflow, **and `factors`** (the per-factor 0–1 scores — required for weight calibration).

Local persistence: **SwiftData** (or Core Data). Sync mirror: Supabase (§4).

### StructureKind enum + tide preference (`STRUCT_TIDE`)
```
flat     → rising,  wantHigh   "fish push onto the flat as it floods"
oyster   → falling, wantLow    "outgoing flushes bait off the bar"
creek    → falling, wantLow    "falling tide pulls bait out of the creek"
mangrove → rising,  wantHigh   "high water lets fish reach the roots"
dock     → any                 "ambush spot — wants water moving"
pothole  → any,     wantLow    "low tide concentrates fish in the hole"
channel  → any                 "edge fishes best on hardest current"
point    → any                 "point fishes on moving water either way"
bridge   → any                 "wants current sweeping through"
jetty    → falling             "outgoing stacks bait in the pass"
```

### Species (TX-first order)
`Redfish, Trout, Black drum, Flounder, Sheepshead, Jack, Snook, Tarpon, Mangrove snapper, Cobia`

---

## 3. Scoring engine (port exactly — pure functions, unit-test these first)

Final score = `round(clamp(Σ weight[k]·factor[k]) · habitatMult, 0…1) · 100`.

### Base weights
```
tideMove .22   tideStage .16   water .13   timeOfDay .13
solunar  .09   wind      .07   pressure .06  structure .14
```
Use calibrated weights if present (see calibration), else base.

### Factors (each returns 0…1)

**tideMove** — `|slopeAt(t)| / tide.maxSlope`, then wind-tide adds flow: `m + w·(1-m)` where `w = min(|windTideFt|/1.5, 1)·0.25`. No tide → `.55`.

**tideStage** — from `STRUCT_TIDE[structure]`:
- `pos` = normalized level `(h-minV)/range` (0 low…1 high), adjusted by wind tide `+ windTideFt/range·0.7`.
- phase falling → rising?`.35`:`.85`; phase rising → rising?`.85`:`.4`; phase any → `.6`.
- if wantHigh: `s·.6 + pos·.4`; if wantLow: `s·.6 + (1-pos)·.4`.

**water** — `tempActivity(waterTemp, species) · seasonMod · salinityMod · tempTrend`:
- `tempActivity`: per-species band `[optLo,optHi,hardLo,hardHi]` → 1 inside opt band, lerp down to `.1` at hard edges, `.1` beyond. Take **max** across the spot's species. Generic band `[66,84,54,91]` if no species.
- `SPECIES_TEMP`:
  ```
  Snook[70,86,60,93] Tarpon[75,90,70,95] Redfish[62,84,50,92] Trout[58,78,48,86]
  Flounder[55,72,46,82] Sheepshead[50,70,40,78] Jack[68,86,58,93]
  Mangrove snapper[70,86,62,92] Black drum[55,78,46,86] Cobia[68,84,62,90]
  ```
- `seasonMod`: `SPECIES_SEASON[species][month]` (0=Jan), max across species:
  ```
  Redfish   [.85,.85,.9,1,1,.95,.9,.92,1,1.12,1.12,.95]
  Trout     [.8,.82,.95,1,1,.95,.85,.85,.95,1,.98,.88]
  Snook     [.5,.5,.7,.9,1,1.1,1.1,1.05,1,.8,.6,.5]
  Tarpon    [.4,.4,.5,.7,1,1.1,1.1,1,.9,.7,.5,.4]
  Flounder  [.7,.7,.78,.85,.85,.8,.8,.85,.95,1.15,1.1,.85]
  Sheepshead[1.12,1.15,1.1,.92,.8,.7,.68,.7,.8,.9,1,1.1]
  Black drum[1.05,1.12,1.15,1.05,.9,.85,.85,.85,.9,.95,1,1.05]
  Jack      [.6,.6,.72,.85,1,1.05,1.05,1,.95,.85,.7,.6]
  Mangrove snapper[.6,.6,.72,.85,1,1.05,1.05,1,.95,.85,.7,.6]
  Cobia     [.6,.7,.9,1.1,1.1,.9,.8,.8,.9,.95,.8,.6]
  ```
- `salinityMod(species, streamCfs)`: high=cfs>2500, vhigh=cfs>6000. Trout/Sheepshead/Mangrove snapper: vhigh→×.8, high→×.92. Redfish/Black drum: high→×1.03.
- tempTrend (°F over 2 days): >3 →×1.06; <-5 →×.82; <-2 →×.92.

**timeOfDay** — max of golden-hour bell (±75 min around sunrise/sunset) and a base:
- base .42; midday 10–16h → summer .3 / else .5; night → Snook/Tarpon .6 else .35; cloud>65% → max(base, summer .55 / else .62).

**solunar** — major periods: `bell(t-major, σ=55min)`; minor periods: `.65·bell(t-minor, σ=45min)`. New/full (`illum<.06`||`>.94`) +.25 bonus; quarter (`.44<illum<.56`) −.1. Return `clamp(best·.8 + .25 + bonus)`.

**wind (mph)** — <3→.68; ≤14→`1-|mph-9|/14·.18`; ≤20→lerp(.8,.35); else .2.

**pressure** — falling trend (mb/3h) −0.4…−3 → .9; ≤−3 → .72; rising >.6 → .45. 24h trend <−4 → max(.,.85); >4 & p>1020 → min(.,.4). p>1025 & not falling → min(.,.4).

**structure** — from bottom analysis (bathymetry), `0.6` default if none. See §6.

**habitat multiplier** — 0.96–1.20 based on mapped oyster/seagrass proximity (§6).

Helpers: `clamp(x,0,1)`, `lerp(a,b,t)`, `bell(dtMs, mean, sigmaMs) = exp(-((dt-mean)²)/(2σ²))`.

### Calibration (`calibrateWeights`)
Needs **≥4 catches + ≥2 blanks** (from `conditions.factors`). For each factor: `mc`=mean over catches, `mb`=mean over blanks; `out[k] = max(base·0.3, base·(1 + λ·2·(mc-mb)))` where `λ = min(1, rowCount/30)`. Normalize to sum 1. Persist. This is what makes the app learn each angler's patterns.

### Tide math
- Curve = 30-min NOAA predictions over multi-day window. `heightAt(t)` linear-interp; `slopeAt(t)` = central diff over ±1h (ft/hr); `maxSlope` precomputed; `range = maxV-minV`.
- **Wind tide** = latest observed water level − predicted at same time.

### Moon / solunar
- `moonInfo(date)`: synodic 29.530588853, ref `2000-01-06 18:14 UTC`; `illum=(1-cos(2π·age/syn))/2`; waxing = age < syn/2. Phase name by age thresholds.
- `moonSolunar(lat,lng,date)`: low-precision Meeus moon rise/set/transit → majors = transit ±12.42h; minors = rise & set times.

---

## 4. Supabase (unchanged backend)
- Project: **`xsnjxqruybhxdandcmol`** ("DriveLog"). URL `https://xsnjxqruybhxdandcmol.supabase.co`.
- Anon/publishable key in the web client (RLS-guarded, safe to embed). Use **`supabase-swift`** SDK.
- Tables (permissive anon RLS):
  - `salt_spots`: `id, sync_code, name, structure, species(jsonb), notes, lat, lng, created_at, updated_at`
  - `salt_catches`: `id, sync_code, kind, spot_id, spot_name, lat, lng, species, count, length_in, bait, notes, structure, conditions(jsonb), caught_at`
- **Sync model**: a user-chosen `sync_code` (default `POC-xxxxx`). All rows filtered by it. Enter same code on another device to share. Store locally.

### Edge functions (Deno, deployed — call, don't rebuild)
All at `${SB_URL}/functions/v1/<name>`, `Authorization: Bearer <anon>`, `apikey: <anon>`.
- **`ollama-agent`** — POST `{instruction, payload}` → `{text, model}` (model `gpt-oss:120b-cloud`). Used by AI pattern finder + AI trip plan.
- **`lure-vision`** — POST `{model:'gemma4:31b', image:<base64>}` → `{style,color,brand,confidence,notes}`. (`{list:true}` lists models.) Ollama Cloud native `/api/chat`.
- **`sentinel`** — GET `?mode=dates&bbox=...&days=50` → `{dates:[{date,cloud}]}`; `?mode=image&bbox=...&w=&h=&date=` → PNG. Copernicus Sentinel-2.
- **`erddap-time`** — GET `?dataset=jplMURSST41` → latest SST timestamp (CORS proxy).

---

## 5. External data APIs (all free, no keys client-side)

**NOAA CO-OPS** (`api.tidesandcurrents.noaa.gov`):
- Station list: `/mdapi/prod/webapi/stations.json?type=tidepredictions` (and `type=watertemp`). Cache; separate service from datagetter.
- Tide predictions: `/api/prod/datagetter?station=<id>&product=predictions&datum=MLLW&time_zone=lst_ldt&units=english&format=json&interval=30&begin_date=<yyyymmdd>&end_date=<>` (+ `interval=hilo` for highs/lows).
- Water temp: `...&product=water_temperature&date=latest`.
- Observed water level (for wind tide): `...&product=water_level&date=recent&datum=MLLW`.
- NOAA 504s often — retry with backoff, reject HTML error pages, cache tide curves (deterministic) and station lists.

**Open-Meteo** (no key):
- Forecast: `https://api.open-meteo.com/v1/forecast?latitude=&longitude=&current=temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl,cloud_cover&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,pressure_msl,cloud_cover,weather_code&daily=sunrise,sunset,temperature_2m_mean,weather_code&past_days=2&forecast_days=7&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`
- Marine (SST, waves): `https://marine-api.open-meteo.com/v1/marine?...&current=wave_height,sea_surface_temperature&length_unit=imperial`
- Historical (backdated catches): `https://archive-api.open-meteo.com/v1/archive?...&start_date=&end_date=` (or forecast `past_days` ≤ 90).

**USGS streamflow** (TX freshwater inflow proxy, Guadalupe R @ Victoria): `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=08176500&parameterCd=00060&siteStatus=active`.

**Habitat (region-aware ArcGIS REST, GeoJSON, bbox query):**
- FL FWC: oyster `https://gis.myfwc.com/hosting/rest/services/Open_Data/Oyster_Beds_Statewide/MapServer/17`; seagrass `.../Seagrass_Statewide/MapServer/15`.
- TX TPWD: base `https://services1.arcgis.com/1mtXwieMId59thmg/arcgis/rest/services`; seagrass `Seagrass_Merged_Layer__TPWD_2021/FeatureServer/0`; oyster per-bay layers (Espiritu Santo, Lavaca-TP, East Matagorda, Aransas, Copano, Galveston).
- Pick layer set by lat/lng bbox region.

**Bathymetry (structure factor):** NCEI CUDEM `https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer` — `getSamples` (chunked POST) for an n×n grid → slope/relief/feature classification. ENC channels: `https://encdirect.noaa.gov/arcgis/rest/services/encdirect/enc_harbour/MapServer`.

**Satellite/overlays (map tiles — `MKTileOverlay`):** Esri World Imagery, Google (unofficial), USGS; EOX Sentinel-2 cloudless composite `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-<year>_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg`; MUR SST via `erddap-time` + WMS.

**Default location:** Port O'Connor, TX — `28.45, -96.40`, zoom ~11. Region: Matagorda & Espíritu Santo Bays.

---

## 6. Bottom structure + habitat tagging
- Sample DEM grid around a spot → compute slope, relief, classify hole/bar/edge/flat → `structure` factor = `0.42·slopeNorm + 0.40·reliefNorm + featureBonus + channelBonus` (clamped). `0.6` if no data.
- Habitat: point-in-polygon + ~80m proximity against oyster/seagrass layers → tags + multiplier (continuous grass / oyster reef boost).

---

## 7. Charts (use Swift Charts — replaces hand-rolled SVG)
- **Tide**: predicted curve + observed (wind-tide gap), high/low markers, now line. ~36h window.
- **Wind**: hourly speed + gust band, shaded ideal 6–14 mph band, direction labels, day dividers. ~2.5-day.
- **Air temp**: hourly temp, night shading (sunset→sunrise), dashed water-temp reference line. ~3-day.
- **Bite**: score over next 48h + best-window blocks; 7-day day-peak outlook.

---

## 8. Suggested Swift project layout
```
SaltSpots/
  App/            SaltSpotsApp.swift, RootTabView.swift
  Models/         Spot, Catch, Conditions, StructureKind, enums
  Scoring/        ScoreEngine.swift, Weights, TideMath, Moon, Solunar  ← port + unit tests FIRST
  Services/       NOAAService, OpenMeteoService, USGSService, HabitatService, DEMService, SupabaseClient, EdgeFunctions
  Features/
    Map/  Spots/  Catches/  Plan/  Today/  Forecast/  Settings/
  Charts/         TideChart, WindChart, TempChart, BiteChart (Swift Charts)
  Support/        Formatters, Extensions, Icons (SF Symbols)
```
Use **SF Symbols** for icons (the web app just moved to line icons — SF Symbols are the native equivalent: `fish`, `map`, `calendar`, `moon`, `wind`, `thermometer`, `location`, etc.).

---

## 9. Day-1 plan (on the Mac)
1. Install: **Xcode** (App Store), then `brew install node cocoapods` (Node only if any tooling needs it; SPM preferred).
2. New Xcode project → **App**, SwiftUI, iOS 17, set bundle ID + team (your Apple Developer account).
3. Add **`supabase-swift`** via Swift Package Manager.
4. `Info.plist` permission strings: `NSLocationWhenInUseUsageDescription`, `NSCameraUsageDescription` (lure photo).
5. **Port the pure logic first** (`Scoring/`): moon/solunar, tide math, factor functions, weights, calibration — with unit tests validating against known values. No UI needed.
6. Build `NOAAService` + `OpenMeteoService`, then a minimal **Today screen** rendering live tide + a real bite score. That proves the pipeline end-to-end.
7. From there: Map + spots, then Plan/Catches/charts, then sync + AI + lure vision.

**Human-only steps** (Claude can't): Xcode signing/team selection, running on Simulator/device, App Store Connect listing + submission, TestFlight invites.

---

## 10. Reuse vs rebuild
- **Reuse as-is (no changes):** Supabase project + tables, all 4 edge functions, every external API. The Swift app is just a new client.
- **Rebuild in Swift:** scoring engine (§3), data services (§5), all UI, charts.
- **Keep running:** the web app — it's the reference implementation and a fallback. Don't break it.

---

## 11. Monetization & data model (design before you build the schema)

**Guiding principle:** every tier boundary is a *carrot* (gain features / remove ads / unlock insights), never a *stick* (never "pay or we expose you"). Spots are sacred to anglers — trust is the whole game.

### Privacy rule (non-negotiable, all tiers)
- **Raw spot locations are NEVER pooled or shared, at any tier, ever.** A user's spots + catch log stay private to their sync code by default.
- The only thing that can ever leave a user's silo is **opt-in, anonymized, location-stripped condition→outcome patterns** (see community model).

### Tiers
**Free**
- Fully private (same privacy as premium — privacy is a promise to *everyone*).
- Ad-supported, but **tasteful/affiliate-leaning**, not blinking banners (see below).
- Personal-tuned scoring, map, spots, catches, tide/wind/temp charts, best windows.
- Opt-in to contribute to the community pool (rewarded with community insights).

**Premium ($X/mo or annual)**
- **No ads** (a strong, well-accepted upgrade hook — people happily pay to remove ads).
- **AI features** — AI trip plan + pattern finder (these cost real Ollama compute → natural paywall).
- **Apple Watch app + widgets/Live Activities** (the native-only payoff).
- Unlimited catch history, advanced/extended forecasts, **offline map downloads**, higher-res recent satellite (Copernicus has per-request cost → natural gate), multi-device sync.
- **Community insights view** (aggregated regional patterns).

### Ads (free tier) — approach
- **Primary = affiliate, using the lure-ID feature as the hook.** Lure photo → identify → "get it on Amazon / Tackle Warehouse" affiliate link. Contextual, useful, far better RPM than display. Extend to species/season tackle recommendations.
- **Local partnerships:** tackle shops, charter guides, marine electronics, boat dealers — targeted local anglers are high-value. One clean sponsored card, native-styled.
- **Minimal display ads** at most, mainly so "remove ads" is worth buying. Avoid interstitials — they clash with the polished, quick-glance UX.
- **Realistic expectation:** display ad revenue is marginal at small scale. Expect **affiliate + subscription** to carry it; ads are a supplement.

### Community model (optional collective learning — opt-in only)
- Contributing users share **anonymized, location-stripped** records: `{conditions → outcome}` (e.g. tide phase, wind dir, water temp, pressure trend, moon → caught/blank + species). **No lat/lng, no spot name, no user identity.**
- In return they get **aggregated regional insight** ("Matagorda: falling-tide SE-wind mornings producing this week").
- Feeds an optional improved **baseline** weight model; a user's *own* calibration still overrides locally.

### Supabase schema implications (design now, not later)
- **Separate the private data from any poolable data at the table + RLS level from day one.**
  - `salt_spots`, `salt_catches` — private, RLS strictly scoped to sync code (tighten beyond today's permissive anon policy for a real multi-user product: per-user auth, not just a shared code).
  - New `community_patterns` (opt-in) — anonymized rows with **no location/identity columns at all** (strip at write time, not just hide at read). Populated only when the user has toggled contribution on.
- **Auth:** for a real subscription product, move from the shared sync-code model to proper user accounts (Sign in with Apple), with sync-code sharing as a *feature* (share your log with a buddy) rather than the identity mechanism.
- **Subscriptions:** StoreKit 2 for IAP; validate entitlement server-side (Supabase edge function verifying the App Store receipt/JWS) before unlocking premium-gated data/features.

### App Store / legal notes
- **Privacy nutrition label + privacy policy** required. Be explicit and honest: what's stored, that spots are never shared, what the opt-in community pool contains (anonymized patterns only).
- **App Tracking Transparency (ATT)** prompt required if any ad SDK tracks across apps (IDFA). Prefer ad/affiliate approaches that avoid cross-app tracking to skip the friction.
- Don't gate privacy behind payment — that framing invites reviewer scrutiny and 1-star reviews. Privacy is free and default; you sell capability and ad-removal.

---

*Generated from `index.html` @ APP_VERSION v46. If the web app advances, re-sync weights/endpoints from the latest source.*
