# NFC Gala Connection Tracker — Full Build Spec

## What This Is

A live connection graph for an 80–120 person gala. Guests wear a handmade bracelet: a 30mm black NTAG213 NFC disc token threaded on a thin black waxed cotton cord, worn on the wrist with a sliding adjustable knot. Each disc is pre-programmed with a unique URL. At check-in, each guest opens their disc URL on their phone and registers (name, email, role). During the event, when Guest A taps their phone to Guest B's disc, a connection is logged between them and the live graph on the venue display updates in real time.

No app install. No QR codes. No staff logging. Guests do nothing except tap.

---

## Physical Token

**Form factor:** 30mm black ABS disc, NTAG213 chip, 5mm centre hole, on a 55cm length of 1mm black waxed cotton cord tied with a sliding adjustable knot. The disc sits on top of the wrist. Guests tap their phone directly to the disc.

**Why this works on iPhone:** iPhones running iOS 13+ automatically read NFC tags and open their encoded URL in Safari — no app, no permission prompt. The phone just needs to be held near the disc. The NFC antenna on most iPhones is near the top edge of the phone; tapping the top of the phone to the disc is the most reliable gesture.

**Bracelet assembly (per unit):**
1. Cut cord to 55cm
2. Thread through the 5mm hole, centre the disc
3. On each cord end, tie a simple overhand knot looped around the opposite cord strand
4. Pull disc toward wrist to tighten; pull both ends to loosen
Assembly time: ~20 seconds per bracelet once practiced. Full batch of 130 takes ~45 minutes.

---

## Tech Stack

- **Backend:** Node.js + Express
- **Database:** SQLite via `better-sqlite3`
- **Real-time:** WebSockets via `ws` library
- **Frontend:** Vanilla JS + D3.js v7 (CDN)
- **Deployment:** Railway.app (provides free HTTPS, public URL, persistent volume)
- **No auth library required** — admin pages protected by a simple token query param

---

## Project Structure

```
/
├── server.js
├── package.json
├── .env
├── data/
│   └── gala.db          (auto-created on first run)
├── public/
│   ├── tap.html         (NFC landing page)
│   ├── register.html    (registration page)
│   ├── registered.html  (post-registration confirmation)
│   ├── graph.html       (live display — big screen)
│   ├── checkin.html     (staff check-in view)
│   └── admin.html       (data export + recap preview)
└── program_wristbands.py
```

---

## Environment Variables

```
ADMIN_TOKEN=<random string, set this before deploy>
DATABASE_PATH=./data/gala.db
PORT=3000
BASE_URL=https://<your-railway-domain>.up.railway.app
```

---

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS guests (
  wristband_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id TEXT NOT NULL REFERENCES guests(wristband_id),
  to_id TEXT NOT NULL REFERENCES guests(wristband_id),
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Deduplication logic (in application code, not schema):**
Before inserting a connection, check whether a row already exists where `(from_id = A AND to_id = B) OR (from_id = B AND to_id = A)`. If yes, return success silently — do not insert a duplicate or return an error.

**Connection normalization:**
Always store connections with the lexicographically smaller wristband_id as `from_id`. This ensures A↔B and B↔A always write the same row and the UNIQUE check is simple.

---

## Routes

### `GET /tap/:wristband_id`

This is the URL encoded on every wristband. iPhones open it instantly in Safari when the phone is held near the wristband.

**Behavior:**
1. Serve `tap.html` with `:wristband_id` injected as a data attribute on the body tag: `<body data-wristband-id="042">`
2. Page JS reads `localStorage.getItem('my_wristband_id')`
3. If localStorage value equals `:wristband_id` → show "That's your own wristband" message with a small animation. Do nothing else.
4. If localStorage value is set AND different → immediately POST `/api/connect` with `{ from_id: localStorage_value, to_id: wristband_id }`. On success show a 2-second success screen with both names and a visual. Then close the tab via `window.close()` or show "You can close this tab."
5. If localStorage is not set → redirect to `/register/:wristband_id`

**Critical constraint:** This page must render and execute its JS in under 2 seconds on a mobile phone on WiFi. No heavy libraries. Inline all CSS and JS. Keep HTML under 10kb.

---

### `GET /register/:wristband_id`

Shown only when a guest hasn't registered yet.

**Page contents:**
- Event name/logo at top (placeholder: "Gala 2025")
- Subheading: "You're almost in."
- Four large role selector buttons (full width, tap to select, one active at a time):
  - VC / Investor
  - Founder
  - Club Member
  - Guest / Mentor
- Name input field
- Email input field
- "Join the room" submit button

**On submit:**
- POST to `/api/register`
- On success: `localStorage.setItem('my_wristband_id', wristband_id)` then redirect to `/registered`
- On error: show inline error message, do not clear fields

**Design:** Mobile-first. Dark background (#0a0a0a), off-white text (#f0ede6). Role buttons should feel like toggles — outlined when inactive, filled when selected. Large touch targets. No decorative elements.

---

### `GET /registered`

Simple confirmation.

**Contents:**
- "You're in." large heading
- "Tap your phone to someone's wristband to connect." subheading
- Small instruction: "The graph on the screen updates in real time."
- No further actions needed.

---

### `GET /graph`

The live display page shown on the venue screen. Fullscreen. No navigation. No controls visible.

**See Graph Visual Spec section below.**

---

### `GET /checkin`

Protected: redirect to `/` if `?token=` query param doesn't match `ADMIN_TOKEN`.

**Contents:**
- Live count: "X guests registered"
- Scrollable table: wristband ID, name, role, time registered
- Auto-refreshes via WebSocket (new_guest events append a row to the top)
- Minimal styling, functional only

---

### `GET /admin`

Protected by `?token=ADMIN_TOKEN`.

**Contents:**
- **Stats section:** Total guests, total connections, most connected guest (name + count), timestamp of first and last connection
- **Export section:** Two buttons: "Download JSON" (hits `/api/export?token=X&format=json`) and "Download CSV" (hits `/api/export?token=X&format=csv`)
- **Recap preview section:** Dropdown to select any guest by name. On selection, shows a preview card:
  - Guest's name and email
  - List of everyone they connected with (name, email, role)
  - A "Copy recap text" button that copies a plain-text version formatted as an email body (see Recap Email Format below)
- **"Copy all recaps" button:** Generates and copies to clipboard a single text block containing all guests' recap data, separated by `---`, ready for manual editing and batch sending

---

## API Endpoints

### `POST /api/register`
```json
Body: { "wristband_id": "042", "name": "Jane Smith", "email": "jane@vc.com", "role": "vc" }
```
- Validate all four fields present and non-empty
- Check wristband_id exists as valid 3-digit ID (001–130)
- If wristband_id already registered: return `{ success: false, error: "Already registered" }`
- Insert into `guests` table
- Insert into `events` table: `{ type: "registration", payload: JSON.stringify({ wristband_id, name, role }) }`
- Broadcast to all WebSocket clients: `{ type: "new_guest", guest: { wristband_id, name, role } }`
- Return: `{ success: true, name: "Jane Smith" }`

### `POST /api/connect`
```json
Body: { "from_id": "017", "to_id": "042" }
```
- Validate both IDs are present
- Check both exist in guests table. If either is unregistered return `{ success: false, error: "One or both guests not registered", from_name: null, to_name: null }` — the tap page should handle this gracefully (show "They haven't checked in yet — come back after they register")
- Check for duplicate connection (both orderings). If duplicate: return `{ success: true, already_connected: true, from_name, to_name }` — tap page shows "Already connected!" message
- Normalize: store with lexicographically smaller ID as from_id
- Insert into connections table
- Insert into events table: `{ type: "connection", payload: JSON.stringify({ from_id, to_id }) }`
- Broadcast to WebSocket clients: `{ type: "new_connection", from: { wristband_id, name, role }, to: { wristband_id, name, role } }`
- Return: `{ success: true, already_connected: false, from_name, to_name }`

### `GET /api/graph`
Returns full current graph state:
```json
{
  "nodes": [{ "wristband_id": "042", "name": "Jane Smith", "role": "vc" }],
  "edges": [{ "from_id": "017", "to_id": "042", "timestamp": "2025-04-25T20:14:32Z" }],
  "stats": { "total_guests": 83, "total_connections": 47 }
}
```

### `GET /api/export`
Protected by `?token=ADMIN_TOKEN`.
- `?format=json` → download full JSON: `{ guests: [...], connections: [...], events: [...] }`
- `?format=csv` → download CSV of connections with columns: `from_id, from_name, from_email, to_id, to_name, to_email, timestamp`
- Default (no format): return JSON inline

---

## Graph Visual Spec (`graph.html`)

### Layout
- Full viewport, no scrollbars, no margins
- D3 v7 force-directed simulation: `forceLink` + `forceManyBody` (repulsion) + `forceCenter`
- SVG fills 100vw × 100vh
- On load: fetch `/api/graph`, populate nodes and edges, start simulation
- Connect to WebSocket on load, handle `new_guest` and `new_connection` events

### Background
- Default: `#0a0a0a` (near-black)
- Alternate: `#f5f2ec` (off-white)
- Toggle with `T` key. Persists in `localStorage('graph_theme')`
- Smooth CSS transition on background color (0.4s)

### Node States

**Ghost node (pre-populated, not yet registered):**
- Pre-populate all 130 possible nodes on load as ghosts
- Radius: 3px
- Color: `#1e1e1e` on dark theme, `#e8e4de` on light theme
- No label
- Pinned / static (not part of force simulation)
- No glow

**Registered node:**
- Radius: 10px (animated from 3px over 0.6s on registration event)
- Color: `#f5f0e6` on dark theme, `#1a1a1a` on light theme
- Soft outer glow: CSS `filter: drop-shadow(0 0 6px rgba(245,240,230,0.6))` on dark, `drop-shadow(0 0 6px rgba(26,26,26,0.3))` on light
- Enters force simulation (unpinned) with initial velocity
- Name label visible on hover (tooltip-style, appears below node)

**Pulse animation (on new connection):**
- A ring expands outward from the node and fades: scale 1→2.5, opacity 1→0 over 0.8s
- Triggered on both endpoint nodes of a new connection

### Edge States
- Color: `rgba(245,240,230,0.25)` on dark, `rgba(26,26,26,0.2)` on light
- Stroke width: 1px base, scales up to 2px for highly-connected nodes
- New edge: animate in using stroke-dashoffset (draws from source to target over 0.5s)

### Counter
- Bottom center, fixed position
- Text: `47 connections · 83 guests`
- Small (13px), muted color (`#444` on dark, `#aaa` on light)
- Updates in real time via WebSocket

### Force Simulation Settings
- `forceManyBody().strength(-80)` — nodes repel each other
- `forceLink().distance(120)` — edge rest length
- `forceCenter()` — centered in viewport
- `alphaDecay(0.01)` — simulation stays warm, nodes drift gently when idle
- `velocityDecay(0.4)` — smooth movement

### WebSocket Handling (graph.html)
- On `new_guest`: add node to simulation (transition from ghost state), update counter
- On `new_connection`: add edge, trigger pulse on both nodes, update counter
- On WebSocket disconnect: attempt reconnect every 3 seconds silently

---

## Tap Page UX Details (`tap.html`)

States to handle:

| State | Display |
|---|---|
| Not registered | Redirect to /register/:id |
| Own wristband | "That's you! Tap someone else's wristband." |
| Success (new connection) | Large names of both people, brief animation, "Connection made" |
| Already connected | "Already connected! You know each other." |
| Other person not registered | "They haven't checked in yet." |
| Server error | "Something went wrong — try again." |

All states resolve within 2 seconds of page load. The page should feel instant.

---

## Recap Email Format

When copying from admin preview, format as:

```
Hi [Name],

Great to meet you at [Event Name] last night.

Here's who you connected with:

- Alex Chen (VC / Investor) — alex@fund.com
- Priya Sharma (Founder) — priya@startup.com
- Marcus Williams (Club Member) — marcus@harvard.edu

[3 blank lines for manual additions/notes]

— [Your name]
```

The "Copy all recaps" button outputs all guests separated by `---\n\n`.

---

## WebSocket Protocol

Server broadcasts these events to all connected clients:

```json
{ "type": "new_guest", "guest": { "wristband_id": "042", "name": "Jane Smith", "role": "vc" } }
```
```json
{ "type": "new_connection", "from": { "wristband_id": "017", "name": "Alex Chen", "role": "founder" }, "to": { "wristband_id": "042", "name": "Jane Smith", "role": "vc" } }
```

The server maintains a list of all connected WebSocket clients and broadcasts to all of them on each event. Handle client disconnections gracefully (remove from list on `close` event).

---

## Disc Programming Script (`program_wristbands.py`)

Separate Python script. Uses `nfcpy` library with the ACR122U USB reader. Programs each 30mm disc token in sequence.

**Usage:**
```bash
pip install nfcpy
python program_wristbands.py --count 130 --base-url https://yourdomain.up.railway.app --start 1
```

**Behavior:**
- Reads `--count`, `--base-url`, `--start` args
- Creates (or appends to) `wristband_log.csv` with columns: `wristband_id, url, programmed_at`
- Loop from `--start` to `--count`:
  - Print: "Place wristband 042 on the reader..."
  - Wait for tag detection (blocking)
  - Write NDEF URL record: `{base_url}/tap/{id:03d}`
  - Print: "✓ Wristband 042 programmed — {url}"
  - Append row to CSV
  - Wait 1 second (so you can remove the wristband)
- On keyboard interrupt: print summary of how many were programmed and what `--start` value to use to resume
- On any write error: print error, skip to next, do not increment counter

---

## Railway Deployment Notes

1. Create a Railway project, connect your GitHub repo
2. Add a `Procfile`: `web: node server.js`
3. Enable a persistent volume in Railway dashboard, mount at `/app/data` — the SQLite file must survive redeploys
4. Set all env vars in Railway dashboard (ADMIN_TOKEN, DATABASE_PATH=/app/data/gala.db, BASE_URL)
5. Railway auto-provides HTTPS — your domain will be `<project>.up.railway.app`
6. The graph display page is just a browser tab on any laptop — it needs WiFi but runs nothing locally

---

## Critical Constraints Summary

- `/tap/:id` page must load and act in under 2 seconds on mobile. No heavy JS on this page.
- HTTPS is mandatory — iPhones refuse to follow NFC URLs over HTTP. Railway provides this automatically.
- SQLite file must be on a persistent volume — Railway's ephemeral filesystem resets on redeploy.
- localStorage is per-browser, per-domain. If a guest switches browsers mid-event they need to tap their own wristband again to re-register their identity. Handle gracefully.
- `window.close()` may not work on Safari if the tab wasn't opened by JS. Show a "You can close this tab" message as fallback.
- Connections are unordered pairs — A↔B and B↔A are the same connection. Normalize in storage and deduplicate in the API.
- The graph display must handle 130 nodes and up to ~500 edges without performance issues. Use D3's enter/update/exit pattern correctly.

---

## Hardware Order List

Order all three items today.

**1. NFC disc tokens — GoToTags 200-pack, black, 30mm, 5mm hole, NTAG213**
URL: https://www.amazon.com/dp/B07SRW28B8
Quantity: 1 pack (200 tokens — covers 120 guests with 80 spares for programming errors)
Notes: Black ABS, waterproof, writable NTAG213, 5mm centre hole for threading cord. These are the tokens that get threaded onto the bracelets. Verify Prime delivery before ordering.

**2. Black waxed cotton cord — 1mm, 100 yards**
Search Amazon for "black waxed cotton cord 1mm" or buy at Michaels on Mass Ave, Cambridge.
Quantity: 1 spool (100 yards covers ~65 bracelets at 55cm each; buy 2 spools to be safe)
Cost: ~$6–8 per spool

**3. ACR122U NFC reader/writer**
URL: https://www.amazon.com/dp/B07KRKPWYC
Quantity: 1
Purpose: Programming all disc tokens with their unique URLs before the event. Used with the Python script above.

**Total hardware cost estimate:**
- Disc tokens (200-pack): ~$80–120
- Waxed cord (2 spools): ~$14
- ACR122U reader: ~$40
- **Total: ~$135–175**

---

## Pre-Event Timeline

| Day | Task |
|---|---|
| Today | Order all hardware. Create Railway account. Create GitHub repo. |
| Day 2 | Autocoder builds the full app from this spec. Test on your own phone end-to-end. |
| Day 3 | Hardware arrives. Run programming script — program all 130 discs. Assemble bracelets (45 min). |
| Day 4 | Venue walkthrough. Confirm WiFi. Set up backup hotspot. Test graph on a large display. Deploy final build to Railway. |
| Day 5 (event) | One staff member runs check-in for first 30 min. Everything else runs itself. |

---

## What NOT to Build

- No login system, no sessions, no cookies (localStorage only)
- No email sending — recap is manual copy-paste from admin page
- No mobile app
- No QR code scanning
- No admin editing of guest records (export only)
- No pagination on any endpoint — dataset is small enough to return in full