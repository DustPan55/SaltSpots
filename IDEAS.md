# InshoreIQ — Feature Ideas

Running list of feature ideas to build into the native iOS app. Captured from the VM so they can be pulled on the Mac. Each entry has the concept, user flow, technical notes (screens / data / edge functions), and open questions.

---

## 1. Regulations + Fish ID ("Is it legal?")

**Concept.** In Settings, pick your **state**; then a button opens a **regulations reference** for that state — popular inshore species shown by default, with search for any fish. For each fish, show the key rules: **minimum length limit, slot size, and daily bag limit** (plus season open/closed if applicable). You can also **photo-ID a fish** (like the lure ID) to pull up the right species and its limits fast.

**Why.** On the water you need to know instantly: is this a keeper? Wrong info = a ticket. This turns the app into a quick legal check right where you're already logging catches.

### User flow
1. **Settings → State** (persisted). Optionally auto-suggest from GPS/last location.
2. **"View regulations"** button → Regulations screen:
   - Popular species for that state listed first (TX: redfish, trout, flounder, black drum, sheepshead, snook…).
   - **Search bar** to find any species.
3. Tap a species → detail: **min length, slot (min–max), bag limit/day, season, region notes, "official source" link**.
4. **Photo ID:** camera button → take a picture of the fish → vision model identifies the species → jumps straight to that species' regs (with a "confirm species" step, since fish ID is less certain than lure ID).
5. **Keeper checker (bonus):** enter the measured length → app says **KEEPER / RELEASE (undersize / oversize / out of slot)** and shows remaining bag context. Great for a fast keep-or-toss decision.

### Where it surfaces
- **Settings:** state selector + entry point.
- **Regulations tab or sheet:** the reference itself.
- **Inside the catch-log flow:** a "Check regs / ID fish" button so when you land one you can ID → check limits → decide keep/release, then log it. Natural tie-in with the existing catch logger.

### Technical notes (native build)
- **Fish photo ID = reuse the vision pattern.** You already have `lure-vision` (Ollama Cloud, gemma4:31b via `/api/chat`). Add a **`fish-vision`** edge function (or generalize the existing one with a `subject: 'fish'|'lure'` param) that returns `{species, confidence, notes}`. Same base64 image pipeline. On device, later, this could move to **Core ML** for offline/instant ID.
- **Regulations data — the hard part, plan for it.** There is **no reliable free universal API** for state fishing regs; they're state-specific and change (often annually). Recommended approach:
  - A **Supabase table `regulations`**: `state, species, common_names[], min_length_in, max_length_in (slot upper, null if none), bag_limit, season_note, region_note, source_url, updated_at`.
  - **Seed it from official sources** (TX Parks & Wildlife TPWD, FL FWC, etc.) — curated by hand for the popular inshore species first, expand outward.
  - Editable **without an app release** (it's just data in Supabase) — important because regs change and you must keep them current.
- **Species matching:** map the vision model's species guess + search terms to the `regulations` rows via `common_names[]` (redfish = red drum = red, spotted seatrout = speckled trout = trout, etc.).
- **Slot logic:** `min_length` = must be at least; `max_length` present = slot (keep only within min–max); bag = per person per day. Keeper checker compares measured length against these.

### ⚠️ Critical caveats
- **Legal disclaimer is mandatory.** Regs data can be wrong/outdated; a wrong bag limit could get someone fined. Every regs view must show **"Always verify with [state agency] — regulations change"** and link to the **official source**. Never present it as authoritative.
- **Keep data current** — stale regs are worse than none. Consider an `updated_at` shown to the user and a periodic review reminder.
- Start with **TX + FL** (your actual coverage) and grow; don't promise all-50-states until the data's real.

### Open questions
- Which states at launch? (TX + FL first?)
- Auto-detect state from GPS, or manual pick only?
- Do you want the **keeper checker** (length → keep/release) in v1, or just the reference + ID?
- Fish ID confidence: always require user to confirm the species before showing limits?
