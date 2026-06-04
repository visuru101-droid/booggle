// ═══════════════════════════════════════════════════════
// Pooggle Multiplayer — Server Configuration
// ═══════════════════════════════════════════════════════
//
// LOCAL DEVELOMENT: Leave as-is (connects to localhost:8081)
// PRODUCTION: Set this to your deployed WebSocket server URL
//
// Examples for production deployment:
//   Render.com:    "wss://pooggle-server.onrender.com"
//   Heroku:        "wss://pooggle-backend.herokuapp.com"
//   Railway:       "wss://pooggle.railway.app"
// ═══════════════════════════════════════════════════════

const POOGGLE_SERVER_URL = "https://booggle.onrender.com/"; // Set to your server URL, or null for localhost