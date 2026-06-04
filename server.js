const express = require("express");
const { WebSocketServer } = require("ws");
const http = require("http");
const path = require("path");

const PORT = process.env.PORT || 8081;

// Create Express app for static file serving
const app = express();
app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Serve index.html at root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

server.listen(PORT, () => {
  console.log(`Game server running on port ${PORT}`);
});

// ── In-memory room store ──
const rooms = new Map();

// Track client room memberships: ws -> roomCode
const clientRooms = new Map();

function broadcastToRoom(roomCode, data, excludeWs) {
  const messageStr = JSON.stringify(data);
  for (const [ws, code] of clientRooms.entries()) {
    if (code === roomCode && ws !== excludeWs && ws.readyState === 1) {
      ws.send(messageStr);
    }
  }
}

function broadcastAll(roomCode, data) {
  const messageStr = JSON.stringify(data);
  for (const [ws, code] of clientRooms.entries()) {
    if (code === roomCode && ws.readyState === 1) {
      ws.send(messageStr);
    }
  }
}

function getPlayersInRoom(roomCode) {
  const players = [];
  for (const [ws, code] of clientRooms.entries()) {
    if (code === roomCode) {
      players.push(ws.playerId);
    }
  }
  return players;
}

// ── WebSocket connection handler ──
wss.on("connection", (ws) => {
  console.log(`Client connected (${new Date().toISOString()})`);

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {

        // ── Create a new room ──
        case "create-room": {
          const { roomCode, playerId, playerName } = data;
          ws.roomCode = roomCode;
          ws.playerId = playerId;
          ws.playerName = playerName;
          clientRooms.set(ws, roomCode);

          const room = {
            code: roomCode,
            hostId: playerId,
            status: "lobby",
            board: data.board || null,
            startedAt: null,
            endsAt: null,
            players: [{ id: playerId, name: playerName, joinedAt: Date.now(), words: [] }]
          };

          rooms.set(roomCode, room);
          broadcastAll(roomCode, { type: "room-updated", room });
          console.log(`Room ${roomCode} created by ${playerName}`);
          break;
        }

        // ── Join an existing room ──
        case "join": {
          const { roomCode, playerId, playerName } = data;
          ws.roomCode = roomCode;
          ws.playerId = playerId;
          ws.playerName = playerName;
          clientRooms.set(ws, roomCode);

          const room = rooms.get(roomCode);
          if (!room) {
            ws.send(JSON.stringify({ type: "room-missing", roomCode }));
          } else {
            // Add player to room if not already present
            const existingIndex = room.players.findIndex((p) => p.id === playerId);
            if (existingIndex === -1) {
              if (room.players.length >= 8) {
                ws.send(JSON.stringify({ type: "room-full", roomCode }));
              } else {
                room.players.push({ id: playerId, name: playerName, joinedAt: Date.now(), words: [] });
                broadcastAll(roomCode, { type: "room-updated", room });
                console.log(`Player ${playerName} (${playerId}) joined room ${roomCode}`);
              }
            } else {
              // Update player name if changed
              room.players[existingIndex].name = playerName;
              broadcastAll(roomCode, { type: "room-updated", room });
            }

            // Send current state to the joining client
            ws.send(JSON.stringify({ type: "room-updated", room }));
          }
          break;
        }

        // ── Update room state (from host or any player) ──
        case "update": {
          const { room } = data;
          if (room && room.code) {
            rooms.set(room.code, room);
            broadcastAll(room.code, { type: "room-updated", room });
          }
          break;
        }

        // ── Leave a room ──
        case "leave": {
          const roomCode = data.roomCode || ws.roomCode;
          if (roomCode) {
            const room = rooms.get(roomCode);
            if (room) {
              // Remove this player from the room
              room.players = room.players.filter((p) => p.id !== ws.playerId);

              // If host left, assign new host
              if (room.hostId === ws.playerId && room.players.length > 0) {
                room.hostId = room.players[0].id;
              }

              // Clean up if empty
              if (room.players.length === 0) {
                rooms.delete(roomCode);
                console.log(`Room ${roomCode} deleted (empty)`);
              } else {
                broadcastAll(roomCode, { type: "room-updated", room });
              }
            }
          }
          clientRooms.delete(ws);
          break;
        }

        // ── Request room state ──
        case "request-room": {
          const room = rooms.get(data.roomCode);
          if (room) {
            ws.send(JSON.stringify({ type: "room-updated", room }));
          } else {
            ws.send(JSON.stringify({ type: "room-missing", roomCode: data.roomCode }));
          }
          break;
        }

        // ── Request all rooms (for debugging) ──
        case "request-rooms": {
          const roomList = Array.from(rooms.values());
          ws.send(JSON.stringify({ type: "room-list", rooms: roomList }));
          break;
        }
      }
    } catch (err) {
      console.error("Error processing message:", err);
    }
  });

  // ── Handle disconnect ──
  ws.on("close", () => {
    const roomCode = clientRooms.get(ws);
    if (roomCode) {
      const room = rooms.get(roomCode);
      if (room && ws.playerId) {
        // Remove disconnected player
        room.players = room.players.filter((p) => p.id !== ws.playerId);

        // Transfer host if needed
        if (room.hostId === ws.playerId && room.players.length > 0) {
          room.hostId = room.players[0].id;
        }

        if (room.players.length === 0) {
          rooms.delete(roomCode);
          console.log(`Room ${roomCode} deleted (empty)`);
        } else {
          broadcastAll(roomCode, { type: "room-updated", room });
        }
      }
    }
    clientRooms.delete(ws);
    console.log("Client disconnected");
  });

  // ── Handle errors ──
  ws.on("error", (err) => {
    console.error(`WebSocket error: ${err.message}`);
  });
});

// ── Health check endpoint ──
app.get("/health", (req, res) => {
  res.json({ status: "ok", rooms: rooms.size });
});
