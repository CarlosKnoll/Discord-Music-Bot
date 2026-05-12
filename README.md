# 🎵 Discord Music Bot

---

## Features

- Play YouTube audio by URL or search query
- Queue system with auto-advance
- Playlist support — queue an entire YouTube playlist intentionally
- Automatic playlist URL stripping on `/play` to avoid accidental full-playlist queues
- Track prefetching — resolves the next track's stream URL while the current one plays, for near-instant transitions
- Adaptive volume normalization via `dynaudnorm` (FFmpeg) — consistent loudness across tracks
- Pause, resume, skip, stop
- Per-guild volume control
- Auto-leave when everyone leaves the voice channel
- Automatic voice reconnection on network drops
- Runs persistently under PM2 — survives crashes and reboots

### Jukebox:
 
- **Ambient mode** — bot auto-joins a voice channel when anyone enters and plays the next track from a shuffled pool sourced from a collaborative Google Sheet, then leaves when done
- **Playlist mode** — queues the entire remaining pool in shuffle order via `/jukebox playlist`, draining it without repeats
- **Two-queue priority system** — user requests via `/play` always take priority over jukebox tracks; both queues coexist without interference
- **Collaborative pool** — URL pool is sourced from a shared Google Sheet; any member can add links and `/jukebox update` merges new entries without restoring already-played URLs
- **Per-guild isolation** — pool state, consumed URL tracking, and ambient toggle are fully independent per server
- **Persistent shuffle** — the shuffled play order survives bot restarts and crashes; the bot resumes exactly where it left off without re-randomising
- **Automatic pool reload** — pool replenishes itself after the full list is exhausted, ready for the next session without manual intervention
- `/skip` is universal — works regardless of whether the current track originated from a user request, jukebox playlist, or ambient trigger

---

## Prerequisites

Before setting up the bot, install the following on your machine:

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **yt-dlp** — YouTube extraction engine
- **FFmpeg** — Audio processing

### Installing yt-dlp

**Linux / Raspberry Pi:**
```bash
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

**macOS:**
```bash
brew install yt-dlp
```

**Windows:**
```bash
winget install yt-dlp
```

### Installing FFmpeg

**Linux / Raspberry Pi:**
```bash
sudo apt install ffmpeg
```

**macOS:**
```bash
brew install ffmpeg
```

**Windows:**
```bash
winget install ffmpeg
```

Verify both are available on your PATH:
```bash
yt-dlp --version
ffmpeg -version
```

---

## Discord Application Setup

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) and click **New Application**
2. Name it and confirm
3. Go to the **Bot** tab → **Add Bot**
4. Under **Privileged Gateway Intents**, enable:
   - `SERVER MEMBERS INTENT`
   - `MESSAGE CONTENT INTENT`
5. Copy your **Bot Token** — you'll need it in the next section
6. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot` + `applications.commands`
   - Bot Permissions: `Connect`, `Speak`, `Send Messages`, `Use Slash Commands`
7. Open the generated URL and invite the bot to your server

---

## Project Setup

### 1. Clone and install dependencies

```bash
git clone <your-repo-url>
cd discord-music-bot
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```env
# Discord Bot Credentials
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_id_here  # Developer Portal > General Information > Application ID

# Optional: only needed during development for instant slash command registration on a single server.
# Comment out or remove for multi-server / production use.
# GUILD_ID=your_server_id_here

# Jukebox — Google Sheets Integration:
GOOGLE_SERVICE_ACCOUNT_JSON=./service-account.json
GOOGLE_SHEET_ID=your_sheet_id_here        # Collaborative sheet shared with your members
GOOGLE_STATE_SHEET_ID=your_state_sheet_id_here  # Private sheet — do not share with anyone
```

To get your **Server ID**: in Discord, enable Developer Mode (User Settings → Advanced → Developer Mode), then right-click your server icon → **Copy Server ID**.

To get your **Sheet ID**: it's the string between `/d/` and `/edit` in your Google Sheet's URL.
 
### 3. Google Sheets Setup *(branch: welcome-jukebox only)*
 
The jukebox uses two separate Google Sheets:

- **Collaborative sheet** (`GOOGLE_SHEET_ID`) — shared with your members; contains the URL pool in column A
- **State sheet** (`GOOGLE_STATE_SHEET_ID`) — private, never shared; stores the shuffled play order and consumed tracking so the bot can resume across restarts

The jukebox reads URLs from a Google Sheet using a service account. If you already have a `service_account.json` from a previous Google API project (e.g. from a Python gspread setup), you can reuse it directly — copy it to the project root as `service-account.json` and skip to step 5.
 
Otherwise:
 
1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project
2. Enable the **Google Sheets API** for that project
3. Go to **IAM & Admin → Service Accounts → Create Service Account**
4. On the service account page → **Keys → Add Key → JSON** — download the file
5. Save it as `service-account.json` in the project root
6. Open your `service-account.json` and copy the `client_email` value
7. Share the **collaborative sheet** with that email → **Viewer** access is sufficient
8. Create a second blank Google Sheet for state — **do not share it with anyone**; share it with the same service account email → **Editor** access required
9. Add `service-account.json` to `.gitignore`

The collaborative sheet should have YouTube URLs in column A, one per row. Any member can add links at any time — use `/jukebox update` to merge new entries into the active pool.

The state sheet is managed entirely by the bot. Its contents are intentionally opaque — this is by design, to preserve the jukebox experience.

### 4. Register slash commands

**For development (instant, single server):**

Uncomment `GUILD_ID` in `.env`, then:
```bash
npm run deploy:guild
```

**For production (all servers, up to ~1 hour propagation):**

Leave `GUILD_ID` commented out and run:
```bash
npm run deploy
```

**For forceful cleanup of guild commands:**

Leave `GUILD_ID` commented out and run:
```bash
npm run cleanup:guild
```

### 5. Build

```bash
npm run build
```

### 6. Run

**Development (ts-node, no build step):**
```bash
npm run dev
```

**Production (compiled, via PM2):**
```bash
pm2 start ecosystem.config.js
```

To persist across reboots:
```bash
pm2 startup   # follow the printed instruction
pm2 save
```

or for windows: add a task in the **task scheduler**.

---

## Commands

| Command | Description |
|---|---|
| `/play [url or search]` | Play a YouTube video or search query. Automatically strips playlist parameters from URLs to play a single track. |
| `/playlist [url]` | Queue an entire YouTube playlist intentionally. |
| `/skip` | Skip the current track. |
| `/queue` | Display the current queue (up to 10 tracks shown). |
| `/pause` | Pause playback. |
| `/resume` | Resume paused playback. |
| `/stop` | Stop playback, clear the queue, and leave the voice channel. |
| `/volume [0–100]` | Set playback volume. |


### Jukebox *(branch: welcome-jukebox)*
 
| Command | Description |
|---|---|
| `/jukebox enable` | Activate ambient mode — bot auto-joins when anyone enters a voice channel and plays the next track from the shuffled pool. Enabled is the default. |
| `/jukebox disable` | Deactivate ambient mode. Does not affect a running playlist. |
| `/jukebox playlist` | Queue the entire remaining pool in its current shuffle order. |
| `/jukebox stop` | Stop jukebox playback and clear the jukebox queue. User-requested tracks continue unaffected. |
| `/jukebox update` | Merge new URLs from the Google Sheet into the active pool, skipping already-consumed URLs. New entries are shuffled and appended after the existing queue. |
 
---
 
## Jukebox Behavior Notes
 
**Ambient mode** is purely event-driven — the bot joins when someone enters a voice channel and plays one track, then leaves. It does not auto-advance or loop. If the pool runs out, it reloads automatically from the sheet for the next trigger.
 
**Playlist mode** and **ambient mode** are independent. Enabling or disabling ambient mode does not interrupt a running playlist. A playlist started via `/jukebox playlist` runs to completion regardless of the ambient toggle.
 
**Queue priority:** user requests via `/play` always take priority over jukebox tracks. If `/play` is called while a jukebox track is playing, the requested track is injected at the front of the user queue and plays immediately after the current track finishes. Once the user queue drains, jukebox playback resumes automatically.
 
**`/jukebox stop`** clears the jukebox queue and stops the current track only if it is jukebox-originated. If a user-requested track is currently playing, it finishes uninterrupted.

**Persistent shuffle:** the bot shuffles the full URL pool once using a Fisher-Yates algorithm and writes the ordered sequence to the private state sheet. Each track played is marked consumed. On restart, the bot resumes from where it left off — no re-randomisation, no replaying recently heard tracks. The shuffle only resets when the entire pool has been exhausted.

**Pool reload:** once every URL in the pool has been played, the bot automatically fetches the sheet fresh, generates a new shuffle, and persists it. No manual `/jukebox update` is needed to start a new cycle.
 
---


## Maintenance

### When YouTube breaks something
```bash
yt-dlp -U
pm2 restart music-bot
```
This resolves ~80% of breakage scenarios. The bot code does not need to change for most YouTube-side issues.

### When you update bot code
```bash
npm run build
pm2 restart music-bot
```

### If the code changes include new commands
```bash
npm run deploy
```

### Useful PM2 commands
```bash
pm2 restart music-bot             # restart after changes
pm2 stop music-bot                # stop without removing
pm2 logs music-bot                # tail live logs
```

### Age-restricted or login-required content

Export a `cookies.txt` from your browser using a browser extension, then point yt-dlp at it by adding the following flag inside `YtdlpExtractor.ts`:

```typescript
cookies: '/path/to/cookies.txt',
```

No other code changes needed.