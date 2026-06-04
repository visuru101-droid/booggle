const express = require("express");
const { WebSocketServer } = require("ws");
const http = require("http");
const path = require("path");
const fs = require("fs");

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

// ── Trie Data Structure for Board Playability Check ──
class TrieNode {
  constructor() {
    this.children = {};
    this.isWord = false;
  }
}

class Trie {
  constructor() {
    this.root = new TrieNode();
  }

  insert(word) {
    let node = this.root;
    for (const char of word) {
      if (!node.children[char]) {
        node.children[char] = new TrieNode();
      }
      node = node.children[char];
    }
    node.isWord = true;
  }
}

const trie = new Trie();
let dictionaryLoaded = false;

function loadServerDictionary() {
  try {
    const dictPath = path.join(__dirname, "dictionary.json");
    if (fs.existsSync(dictPath)) {
      const words = JSON.parse(fs.readFileSync(dictPath, "utf8"));
      for (const word of words) {
        if (word.length >= 3) {
          trie.insert(word.toUpperCase());
        }
      }
      dictionaryLoaded = true;
      console.log(`Loaded dictionary on server: ${words.length} words`);
    } else {
      console.error("dictionary.json not found on server");
    }
  } catch (err) {
    console.error("Failed to load dictionary on server:", err);
  }
}

loadServerDictionary();

const BOGGLE_DICE = [
  "LRYTTE", "VTHRWE", "EGHWNE", "SEOTIS",
  "ANAEEG", "IDSYTT", "OATTOW", "MTOICU",
  "AFPKFS", "XLDERI", "HCPOAS", "ENSIEU",
  "YLDEVR", "ZNRNHL", "NMIQHU", "OBBAOJ"
];

function rollDice() {
  const dice = [...BOGGLE_DICE];
  for (let i = dice.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [dice[i], dice[j]] = [dice[j], dice[i]];
  }
  return dice.map((die) => {
    const face = die[Math.floor(Math.random() * die.length)];
    return face === "Q" ? "QU" : face;
  });
}

function makeBoard() {
  const letters = rollDice();
  return letters.map((letter, index) => ({
    id: index,
    letter,
    row: Math.floor(index / 4),
    col: index % 4,
    rotation: 0
  }));
}

function getValidWordsOnBoard(board) {
  const foundWords = new Set();
  
  const boardGrid = Array.from({ length: 4 }, () => Array(4));
  board.forEach(cell => {
    boardGrid[cell.row][cell.col] = cell;
  });

  function dfs(row, col, visited, trieNode, currentWord) {
    const cell = boardGrid[row][col];
    const letter = cell.letter;

    let node = trieNode;
    for (const char of letter) {
      if (!node.children[char]) {
        return;
      }
      node = node.children[char];
    }

    const newWord = currentWord + letter;
    if (node.isWord) {
      foundWords.add(newWord);
    }

    visited[row][col] = true;

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = row + dr;
        const nc = col + dc;
        if (nr >= 0 && nr < 4 && nc >= 0 && nc < 4 && !visited[nr][nc]) {
          dfs(nr, nc, visited, node, newWord);
        }
      }
    }

    visited[row][col] = false;
  }

  const visited = Array.from({ length: 4 }, () => Array(4).fill(false));
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      dfs(r, c, visited, trie.root, "");
    }
  }

  return foundWords;
}

function getVowelCount(board) {
  const VOWELS = new Set(["A", "E", "I", "O", "U"]);
  let count = 0;
  for (const cell of board) {
    for (const char of cell.letter) {
      if (VOWELS.has(char)) {
        count++;
      }
    }
  }
  return count;
}

function getRareLetterCount(board) {
  const RARE = new Set(["J", "Q", "X", "Z", "K"]);
  let count = 0;
  for (const cell of board) {
    for (const char of cell.letter) {
      if (RARE.has(char)) {
        count++;
      }
    }
  }
  return count;
}

function generatePlayableBoard() {
  let attempts = 0;
  let bestBoard = null;
  let bestScore = -1;
  const MIN_WORDS = 30;

  while (attempts < 150) {
    const board = makeBoard();
    if (!dictionaryLoaded) {
      return board;
    }
    
    const vowels = getVowelCount(board);
    const rareCount = getRareLetterCount(board);
    const hasGoodBalance = vowels >= 4 && vowels <= 7 && rareCount <= 2;
    
    const foundWords = getValidWordsOnBoard(board);
    const count3to4 = [...foundWords].filter(w => w.length === 3 || w.length === 4).length;

    if (hasGoodBalance && count3to4 >= MIN_WORDS) {
      console.log(`Generated playable board on attempt ${attempts + 1} with ${count3to4} words of length 3-4, ${vowels} vowels, and ${rareCount} rare letters.`);
      return board;
    }

    let score = count3to4;
    if (hasGoodBalance) {
      score += 15;
    }
    if (score > bestScore) {
      bestScore = score;
      bestBoard = board;
    }
    attempts++;
  }

  console.log(`Failed to meet ideal constraints after 150 attempts. Using best board with score ${bestScore}.`);
  return bestBoard;
}


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

        // ── Start a new match on server ──
        case "start-match": {
          const { roomCode } = data;
          const room = rooms.get(roomCode);
          if (room) {
            const now = Date.now();
            room.status = "playing";
            room.board = generatePlayableBoard();
            room.startedAt = now;
            room.endsAt = now + 90 * 1000; // 90 seconds
            room.nextMatchVotes = [];
            room.players = room.players.map((p) => ({ ...p, words: [] }));

            rooms.set(roomCode, room);
            broadcastAll(roomCode, { type: "room-updated", room });
            console.log(`Match started in room ${roomCode} with generated playable board`);
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
