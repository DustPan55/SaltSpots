# 🎣 Salt Spots

A private inshore fishing-spot tracker with a live **bite-scoring engine**. Drop spots on a map, and each one gets a 0–100 "bite now" score plus a 48-hour best-windows forecast — built from tides, water temp, time of day, moon/solunar, wind, barometric pressure, and the spot's structure & target species.

Tuned for the **Texas / Florida Gulf coast** (default: Port O'Connor, TX).

## Data sources (all free, no keys in the client)
- **Tides & water temperature** — NOAA CO-OPS (Tides & Currents)
- **Weather, wind, pressure, waves, SST** — Open-Meteo
- **Habitat (oyster reefs & seagrass)** — FL FWC and TX TPWD Coastal Fisheries ArcGIS services
- **Solunar / moon** — computed client-side
- **Spot storage** — Supabase (cross-device sync via a shared sync code); localStorage offline cache

## How the score works
A transparent weighted model — every score breaks down into its factors in the spot detail view:
tide movement (26%), tide-stage × structure (18%), water-temp × species (15%), time of day (15%), solunar (10%), wind (8%), pressure trend (8%), all × a habitat multiplier.

## Run locally
Just open `index.html`, or serve it: `python3 -m http.server` then visit the page (geolocation needs the tab focused).

Scores are a model — local knowledge wins. Always check conditions before heading out.
