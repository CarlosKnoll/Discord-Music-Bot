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
```

To get your **Server ID**: in Discord, enable Developer Mode (User Settings → Advanced → Developer Mode), then right-click your server icon → **Copy Server ID**.

### 3. Register slash commands

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

### 4. Build

```bash
npm run build
```

### 5. Run

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
npm run deploy
```

### Useful PM2 commands
```bash
pm2 restart music-bot             # restart after changes
pm2 stop music-bot                # stop without removing
```

### Age-restricted or login-required content

Export a `cookies.txt` from your browser using a browser extension, then point yt-dlp at it by adding the following flag inside `YtdlpExtractor.ts`:

```typescript
cookies: '/path/to/cookies.txt',
```

No other code changes needed.