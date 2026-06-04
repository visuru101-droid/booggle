# Pooggle Multiplayer

Eight-player online Boggle word game with real dice, live scoring, and unique word bonuses.

## Architecture

```
┌─────────────────┐     WebSocket      ┌───────────────┐
│  GitHub Pages   │ ◄═══════════════► │  Game Server  │
│  (Static Front) │                    │  (Node.js)    │
└─────────────────┘                    └───────────────┘
```

- **Frontend**: Hosted on GitHub Pages (static HTML/CSS/JS)
- **Backend**: WebSocket server running on a separate host (Render, Heroku, etc.)

## Quick Start (Local Development)

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the game server:
   ```bash
   node server.js
   ```

3. Open `http://localhost:8081` in your browser.

4. Test multiplayer by opening multiple tabs/browsers and joining with different names.

## Deployment

### Step 1: Deploy the WebSocket Server (Required)

The game requires a **separate** WebSocket server running 24/7. GitHub Pages only serves static files — it cannot host WebSockets.

#### Option A — Render.com (Free Tier, Recommended)

1. Go to [render.com](https://render.com) and sign up
2. Click **"New"** → **"WebSocket Service"**
3. Connect your GitHub repository
4. Configure:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. Deploy — Render will give you a URL like `https://pooggle-server.onrender.com`

#### Option B — Railway.app (Free Tier)

1. Go to [railway.app](https://railway.app) and sign up
2. Create a new project from your GitHub repo
3. Set start command: `node server.js`
4. Deploy — You'll get a URL like `https://pooggle.railway.app`

#### Option C — Keep running locally (Testing only)

```bash
npm install && node server.js
# Server runs on localhost:8081
```

### Step 2: Configure the Frontend to Connect to Your Server

After deploying, update `config.js`:

```js
const POOGGLE_SERVER_URL = "wss://your-server-url.onrender.com";
// Replace with your actual deployed server URL
```

The client will automatically use this URL. If left as `null`, it defaults to localhost (for local testing only).

### Step 3: Deploy Frontend to GitHub Pages

1. Push all files to your GitHub repository
2. Go to **Settings** → **Pages** → Set deployment branch to `main`
3. Your game will be available at `https://yourusername.github.io/Pooggle/`

### How Players Join

1. Host visits the site, enters their name, clicks **"Create Room"**
2. A 4-character room code appears (e.g., "ABCD")
3. Host shares this code with friends via chat/email/etc.
4. Friends visit the same site, enter their name + room code, click **"Join Lobby"**
5. All players see each other in real-time — host starts the match when ready

## How Room Codes Work

1. **Host** creates a room → gets a 4-character code (e.g., "ABCD")
2. Host shares the code with friends via chat/email/etc.
3. **Players** enter their name + room code and click "Join Lobby"
4. All players see each other in real-time via WebSocket

## Game Flow

1. Players join lobby → host starts match
2. 90-second timed round of finding words on the board
3. Results screen with scoring animation
4. Vote for next match or return to lobby

## Scoring

- Base: `word.length - 2` points (minimum 1)
- Unique bonus: ×2 if only one player found that word