const lobbyView = document.querySelector("#lobby-view");
const matchView = document.querySelector("#match-view");
const resultsView = document.querySelector("#results-view");
const roomPill = document.querySelector("#room-pill");
const lobbyForm = document.querySelector("#lobby-form");
const playerNameInput = document.querySelector("#player-name");
const roomCodeInput = document.querySelector("#room-code");
const createRoomButton = document.querySelector("#create-room");
const startMatchButton = document.querySelector("#start-match");
const leaveRoomButton = document.querySelector("#leave-room");
const rematchButton = document.querySelector("#rematch");
const nextMatchButton = document.querySelector("#next-match");
const lobbyPlayers = document.querySelector("#lobby-players");
const matchPlayers = document.querySelector("#match-players");
const boardEl = document.querySelector("#board");
const boardStage = document.querySelector(".board-stage");
const pathLinesEl = document.querySelector("#path-lines");
const currentWordEl = document.querySelector("#current-word");
const timerEl = document.querySelector("#timer");
const scoreEl = document.querySelector("#score");
const resultsGrid = document.querySelector("#results-grid");
const winnerLine = document.querySelector("#winner-line");
const themeSelect = document.querySelector("#theme-select");
const resultsActionsEl = document.querySelector("#results-actions");
const bestWordEl = document.querySelector("#best-word-line");

const BOARD_SIZE = 4;
const GAME_SECONDS = 90;
const MAX_PLAYERS = 8;

// Official Boggle dice set (16 dice × 6 faces each)
const BOGGLE_DICE = [
  "LRYTTE", "VTHRWE", "EGHWNE", "SEOTIS",
  "ANAEEG", "IDSYTT", "OATTOW", "MTOICU",
  "AFPKFS", "XLDERI", "HCPOAS", "ENSIEU",
  "YLDEVR", "ZNRNHL", "NMIQHU", "OBBAOJ"
];
const PLAYER_ID_KEY = "poogglePlayerId";
const PLAYER_NAME_KEY = "poogglePlayerName";
const LAST_ROOM_KEY = "pooggleLastRoom";
const THEME_KEY = "pooggleTheme";
const channel = "BroadcastChannel" in window ? new BroadcastChannel("pooggle-room") : null;
const LETTER_SCORES = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1,
  J: 8, K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1,
  S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10
};

let currentRoomCode = localStorage.getItem(LAST_ROOM_KEY) || "";
let selected = [];
let isDragging = false;
let pointerPoint = null;
let activePointerId = null;
let tileRects = [];
let tickId = null;
let revealId = null;
let revealComplete = false;
let lastRevealSignature = "";
let socket = null;

// Initialize Theme
const savedTheme = localStorage.getItem(THEME_KEY) || "scrabble";
themeSelect.value = savedTheme;
setTheme(savedTheme);

themeSelect.addEventListener("change", (e) => {
  const theme = e.target.value;
  localStorage.setItem(THEME_KEY, theme);
  setTheme(theme);
});

function setTheme(theme) {
  document.body.className = "";
  if (theme !== "emerald") {
    document.body.classList.add(`theme-${theme}`);
  }
}

// Initialize WebSockets
function connectSocket() {
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  // Use current hostname or default to localhost if opening local file
  const host = window.location.hostname || "127.0.0.1";
  const socketUrl = `${wsProtocol}//${host}:8081`;

  socket = new WebSocket(socketUrl);

  socket.addEventListener("open", () => {
    console.log("WebSocket connected");
    if (currentRoomCode) {
      socket.send(JSON.stringify({
        type: "join",
        roomCode: currentRoomCode,
        playerId: playerId,
        playerName: localStorage.getItem(PLAYER_NAME_KEY) || ""
      }));
    }
  });

  socket.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "room-updated") {
        localStorage.setItem(roomKey(data.room.code), JSON.stringify(data.room));
        render();
      }
    } catch (err) {
      console.error("Error reading socket message:", err);
    }
  });

  socket.addEventListener("close", () => {
    console.log("WebSocket closed. Reconnecting in 3s...");
    setTimeout(connectSocket, 3000);
  });
}

connectSocket();

// Dictionary loaded asynchronously from words_dictionary.json
let WORDS = null;
let dictionaryReady = false;

(async function loadDictionary() {
  try {
    const response = await fetch("words_dictionary.json");
    const data = await response.json();
    // Keys are lowercase; we'll look up lowercase words
    WORDS = data;
    dictionaryReady = true;
    // Update any loading indicator
    const loadingEl = document.getElementById("dict-loading");
    if (loadingEl) loadingEl.remove();
  } catch (err) {
    console.error("Failed to load dictionary:", err);
    // Fallback: allow all words longer than 3 letters
    WORDS = null;
    dictionaryReady = true;
  }
})();

const playerId = getOrCreatePlayerId();
playerNameInput.value = localStorage.getItem(PLAYER_NAME_KEY) || "";
roomCodeInput.value = currentRoomCode;

function getOrCreatePlayerId() {
  const existing = sessionStorage.getItem(PLAYER_ID_KEY);
  if (existing) return existing;

  const id = crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.random()}`;
  sessionStorage.setItem(PLAYER_ID_KEY, id);
  return id;
}

function roomKey(code = currentRoomCode) {
  return `pooggleRoom:${code}`;
}



function readRoom(code = currentRoomCode) {
  if (!code) return null;

  try {
    return JSON.parse(localStorage.getItem(roomKey(code)));
  } catch {
    return null;
  }
}

function writeRoom(room) {
  localStorage.setItem(roomKey(room.code), JSON.stringify(room));
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "update", room }));
  }
  if (channel) {
    channel.postMessage({ type: "room-updated", code: room.code });
  }
  render();
}

function freshCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function rollDice() {
  // Fisher-Yates shuffle of the 16 dice, then pick one random face per die
  const dice = [...BOGGLE_DICE];
  for (let i = dice.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [dice[i], dice[j]] = [dice[j], dice[i]];
  }
  return dice.map((die) => {
    const face = die[Math.floor(Math.random() * die.length)];
    // Q is always paired with U on the same tile
    return face === "Q" ? "QU" : face;
  });
}

function makeBoard() {
  const letters = rollDice();
  return letters.map((letter, index) => ({
    id: index,
    letter,
    row: Math.floor(index / BOARD_SIZE),
    col: index % BOARD_SIZE
  }));
}

function normalizeCode(value) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function normalizeName(value) {
  return value.trim().slice(0, 18) || `Player ${Math.floor(Math.random() * 90) + 10}`;
}

function createRoom(code = freshCode()) {
  const room = {
    code,
    hostId: playerId,
    status: "lobby",
    board: makeBoard(),
    startedAt: null,
    endsAt: null,
    players: []
  };
  currentRoomCode = code;
  roomCodeInput.value = code;
  localStorage.setItem(LAST_ROOM_KEY, code);
  writeRoom(room);
  joinRoom();
}

function joinRoom(event) {
  if (event) event.preventDefault();

  const name = normalizeName(playerNameInput.value);
  const code = normalizeCode(roomCodeInput.value);
  if (!code) return;

  let room = readRoom(code);
  if (!room) {
    room = {
      code,
      hostId: playerId,
      status: "lobby",
      board: makeBoard(),
      startedAt: null,
      endsAt: null,
      players: []
    };
  }

  const existingIndex = room.players.findIndex((player) => player.id === playerId);
  if (existingIndex === -1 && room.players.length >= MAX_PLAYERS) {
    alert("This lobby already has eight players.");
    return;
  }

  const player = {
    id: playerId,
    name,
    joinedAt: Date.now(),
    words: []
  };

  if (existingIndex === -1) {
    room.players.push(player);
  } else {
    room.players[existingIndex] = { ...room.players[existingIndex], name };
  }

  currentRoomCode = code;
  localStorage.setItem(PLAYER_NAME_KEY, name);
  localStorage.setItem(LAST_ROOM_KEY, code);

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "join",
      roomCode: code,
      playerId: playerId,
      playerName: name
    }));
  }

  writeRoom(room);
}

function startMatch() {
  const room = readRoom();
  if (!room || room.hostId !== playerId) return;

  const now = Date.now();
  room.status = "playing";
  room.board = makeBoard();
  room.startedAt = now;
  room.endsAt = now + GAME_SECONDS * 1000;
  room.nextMatchVotes = [];
  room.players = room.players.slice(0, MAX_PLAYERS).map((player) => ({ ...player, words: [] }));
  selected = [];
  revealComplete = false;
  lastRevealSignature = "";
  writeRoom(room);
}

function leaveRoom() {
  const room = readRoom();
  if (!room) return;

  room.players = room.players.filter((player) => player.id !== playerId);
  if (room.hostId === playerId && room.players[0]) {
    room.hostId = room.players[0].id;
  }
  if (room.players.length === 0) {
    localStorage.removeItem(roomKey());
  } else {
    writeRoom(room);
  }
  currentRoomCode = "";
  localStorage.removeItem(LAST_ROOM_KEY);
  selected = [];
  render();
}

function backToLobby() {
  const room = readRoom();
  if (!room) return;

  room.status = "lobby";
  room.startedAt = null;
  room.endsAt = null;
  room.nextMatchVotes = [];
  room.players = room.players.map((player) => ({ ...player, words: [] }));
  revealComplete = false;
  lastRevealSignature = "";
  writeRoom(room);
}

function formatTime(msLeft) {
  const seconds = Math.max(0, Math.ceil(msLeft / 1000));
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function setMessage(text, type = "") {
  // No-op
}

function render() {
  const room = readRoom();
  const inRoom = Boolean(room && currentRoomCode);

  roomPill.textContent = inRoom ? `Room ${room.code}` : "No room";
  lobbyView.hidden = inRoom && room.status !== "lobby";
  matchView.hidden = !inRoom || room.status !== "playing";
  resultsView.hidden = !inRoom || room.status !== "ended";

  if (!inRoom) {
    renderLobbyPlayers(null);
    startMatchButton.disabled = true;
    clearInterval(tickId);
    return;
  }

  renderLobbyPlayers(room);
  if (room.status === "playing") {
    renderMatch(room);
  }
  if (room.status === "ended") {
    renderResults(room);
  }

  startMatchButton.disabled = room.hostId !== playerId || room.players.length === 0;
}

// ── Scoring ──────────────────────────────────────────────────────────────────
// Base: 3 letters = 1pt, 4 = 2pt, 5 = 3pt … (word.length − 2)
// Unique bonus: multiply by 2 if only one player found the word
function getBaseWordPoints(word) {
  return Math.max(1, word.length - 2);
}

function getWordScore(word, allWordsAcrossPlayers) {
  const base = getBaseWordPoints(word);
  const foundByCount = allWordsAcrossPlayers.filter((w) => w === word).length;
  return foundByCount === 1 ? base * 2 : base; // unique ⇒ 2×
}

// Live score (during play — no uniqueness info yet)
function getLiveScore(words) {
  return words.reduce((total, word) => total + getBaseWordPoints(word), 0);
}

// Final score (after match — includes uniqueness bonus)
function getFinalScore(myWords, room) {
  const allWords = room.players.flatMap((p) => p.words);
  return myWords.reduce((total, word) => total + getWordScore(word, allWords), 0);
}

function renderLobbyPlayers(room) {
  lobbyPlayers.innerHTML = "";
  if (!room) return;
  room.players.forEach((player) => {
    const card = document.createElement("article");
    card.className = "player-card";
    const role = room.hostId === player.id ? "Host" : "Ready";
    card.innerHTML = `<div class="player-name"></div><div class="player-meta">${role}</div>`;
    card.querySelector(".player-name").textContent = player.name;
    lobbyPlayers.append(card);
  });
}

function renderMatch(room) {
  if (room.status !== "playing") return;

  renderBoard(room);
  renderMatchPlayers(room);
  updateTimer(room);

  const me = room.players.find((player) => player.id === playerId);
  if (scoreEl) {
    scoreEl.textContent = me ? getLiveScore(me.words) : 0;
  }

  const playing = room.status === "playing";
  document.querySelectorAll(".tile").forEach((tile) => {
    tile.disabled = !playing;
  });

  if (playing && !tickId) {
    tickId = setInterval(() => {
      const latest = readRoom();
      if (!latest) return;
      updateTimer(latest);
      if (Date.now() >= latest.endsAt) {
        endMatch(latest);
      }
    }, 250);
  }
}

function renderBoard(room) {
  if (boardEl.dataset.board === JSON.stringify(room.board)) {
    syncSelectedTiles();
    updateCurrentWord(room);
    drawPath(room);
    return;
  }

  boardEl.dataset.board = JSON.stringify(room.board);
  boardEl.innerHTML = "";

  room.board.forEach((cell) => {
    const tile = document.createElement("button");
    tile.className = "tile";
    tile.type = "button";
    // Display Q as "Qu" (lowercase u) — internally stored as "QU"
    const displayLetter = cell.letter === "QU" ? "Qu" : cell.letter;
    const scoreLetter = cell.letter === "QU" ? "Q" : cell.letter;
    tile.innerHTML = `<span class="tile-letter"></span><span class="tile-score">${LETTER_SCORES[scoreLetter] || 1}</span>`;
    tile.querySelector(".tile-letter").textContent = displayLetter;
    tile.dataset.id = cell.id;
    tile.dataset.letter = cell.letter;
    tile.setAttribute("aria-label", cell.letter === "QU" ? "Letter Qu" : `Letter ${cell.letter}`);
    tile.addEventListener("pointerdown", (event) => startDrag(cell.id, event));
    tile.addEventListener("pointerenter", () => enterTile(cell.id));
    boardEl.append(tile);
  });
  syncSelectedTiles();
  updateCurrentWord(room);
  drawPath(room);
}

function renderMatchPlayers(room) {
  matchPlayers.innerHTML = "";
  room.players.forEach((player) => {
    const card = document.createElement("article");
    card.className = "strip-card";
    card.innerHTML = `<strong></strong><span>${getLiveScore(player.words)} pts · ${player.words.length} words</span>`;
    card.querySelector("strong").textContent = player.name;
    matchPlayers.append(card);
  });
}

function updateTimer(room) {
  timerEl.textContent = room.status === "playing" ? formatTime(room.endsAt - Date.now()) : "00:00";
}

function endMatch(room) {
  if (room.status !== "playing") return;
  room.status = "ended";
  clearInterval(tickId);
  tickId = null;
  selected = [];
  pointerPoint = null;
  updateCurrentWord(room);
  drawPath(room);
  setMessage("Time is up. Counting the room results.", "success");
  writeRoom(room);
}

function areAdjacent(first, second) {
  return Math.abs(first.row - second.row) <= 1 && Math.abs(first.col - second.col) <= 1;
}

function startDrag(id, event) {
  const room = readRoom();
  if (!room || room.status !== "playing") return;

  // Release implicit pointer capture so pointerenter/pointermove works on other tiles
  if (event.target && typeof event.target.releasePointerCapture === "function") {
    try {
      event.target.releasePointerCapture(event.pointerId);
    } catch (e) {
      // Ignore errors if pointer capture is not supported or not active
    }
  }

  // Cache all tile bounding rects for robust collision detection
  tileRects = Array.from(boardEl.querySelectorAll(".tile")).map((tile) => {
    const rect = tile.getBoundingClientRect();
    return {
      id: Number(tile.dataset.id),
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom
    };
  });

  isDragging = true;
  activePointerId = event.pointerId;
  selected = [];
  pointerPoint = getLocalPoint(event);
  addTileToWord(id);
  drawPath(room);
}

function dragAcross(event) {
  if (!isDragging) return;
  if (activePointerId !== null && event.pointerId !== activePointerId) return;

  event.preventDefault();
  pointerPoint = getLocalPoint(event);

  const x = event.clientX;
  const y = event.clientY;

  // Find the nearest tile center, then only activate it if the pointer is
  // within a reduced hit radius (38% of tile width). This creates clear dead
  // zones in the gaps so you can drag between tiles without accidentally
  // triggering the wrong one. The adjacency check in addTileToWord still
  // prevents impossible chain jumps.
  let nearestTile = null;
  let nearestDistSq = Infinity;

  for (const r of tileRects) {
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const distSq = (x - cx) ** 2 + (y - cy) ** 2;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearestTile = r;
    }
  }

  if (nearestTile) {
    const hitRadius = (nearestTile.right - nearestTile.left) * 0.26;
    if (nearestDistSq <= hitRadius * hitRadius) {
      addTileToWord(nearestTile.id);
    }
  }

  drawPath(readRoom());
}

function enterTile(id) {
  if (!isDragging) return;
  addTileToWord(id);
}

function stopDrag(event) {
  if (!isDragging) return;
  if (event && activePointerId !== null && event.pointerId !== activePointerId) return;
  isDragging = false;
  activePointerId = null;
  submitDraggedWord();
  pointerPoint = null;
  drawPath(readRoom());
}

function addTileToWord(id) {
  const room = readRoom();
  if (!room || room.status !== "playing") return;

  const cell = room.board[id];
  const existingIndex = selected.indexOf(id);

  if (selected.length > 0 && existingIndex === selected.length - 1) {
    // Hovering the current last tile — nothing to do
    return;
  } else if (existingIndex !== -1) {
    // Dragged back to a tile already in the chain: backtrack to that point.
    // e.g. chain G-O-O dragged back to first O → chain becomes G-O
    selected = selected.slice(0, existingIndex + 1);
  } else if (selected.length > 0 && !areAdjacent(room.board[selected[selected.length - 1]], cell)) {
    // Non-adjacent tile — silently ignore during drag
    return;
  } else {
    selected.push(id);
  }

  updateCurrentWord(room);
  syncSelectedTiles();
  drawPath(room);
}

function syncSelectedTiles() {
  document.querySelectorAll(".tile").forEach((tile) => {
    const id = Number(tile.dataset.id);
    const isSel = selected.includes(id);
    tile.classList.toggle("is-selected", isSel);
    tile.classList.toggle("is-origin", selected[0] === id);
  });
}

function updateCurrentWord(room) {
  const word = room && selected.length
    ? selected.map((selectedId) => room.board[selectedId].letter).join("")
    : "";
  currentWordEl.textContent = word || "Drag across tiles";
  currentWordEl.classList.toggle("is-building", Boolean(word));
}

function getLocalPoint(event) {
  const rect = boardStage.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function getTileCenter(id) {
  const tile = boardEl.querySelector(`[data-id="${id}"]`);
  if (!tile) return null;

  const tileRect = tile.getBoundingClientRect();
  const stageRect = boardStage.getBoundingClientRect();
  return {
    x: tileRect.left - stageRect.left + tileRect.width / 2,
    y: tileRect.top - stageRect.top + tileRect.height / 2
  };
}

function drawLine(start, end, className = "") {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", start.x);
  line.setAttribute("y1", start.y);
  line.setAttribute("x2", end.x);
  line.setAttribute("y2", end.y);
  if (className) line.setAttribute("class", className);
  pathLinesEl.append(line);
}

function drawPath(room) {
  pathLinesEl.innerHTML = "";
  const rect = boardStage.getBoundingClientRect();
  pathLinesEl.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);

  if (!room || selected.length === 0) return;

  const points = selected.map(getTileCenter).filter(Boolean);
  for (let index = 1; index < points.length; index += 1) {
    drawLine(points[index - 1], points[index]);
  }

  if (isDragging && pointerPoint && points.length > 0) {
    drawLine(points[points.length - 1], pointerPoint, "is-preview");
  }
}

function clearSelection() {
  selected = [];
  pointerPoint = null;
  activePointerId = null;
  updateCurrentWord(readRoom());
  syncSelectedTiles();
  drawPath(readRoom());

  const wordBuildEl = document.querySelector(".word-build");
  if (wordBuildEl) {
    wordBuildEl.classList.remove("is-valid", "is-invalid");
  }
}

function clearSelectionSoon(delay = 450) {
  window.setTimeout(clearSelection, delay);
}

function submitDraggedWord() {
  const room = readRoom();
  if (!room || room.status !== "playing") return;

  const word = selected.map((selectedId) => room.board[selectedId].letter).join("");
  const me = room.players.find((player) => player.id === playerId);
  const wordBuildEl = document.querySelector(".word-build");

  const handleFailure = (msg) => {
    setMessage(msg, "error");
    if (wordBuildEl) {
      wordBuildEl.classList.add("is-invalid");
    }
    clearSelectionSoon(500);
  };

  if (!me) {
    handleFailure("Join the room before submitting words.");
    return;
  }
  if (word.length < 3) {
    handleFailure("Words must be at least 3 letters.");
    return;
  }
  if (!dictionaryReady) {
    handleFailure("Dictionary is still loading, try again.");
    return;
  }
  if (me.words.includes(word)) {
    handleFailure("You already found that word!");
    return;
  }
  // WORDS is the parsed JSON object; keys are lowercase
  if (WORDS && !WORDS[word.toLowerCase()]) {
    handleFailure(`"${word}" is not a valid word.`);
    return;
  }

  me.words.push(word);
  writeRoom(room);
  setMessage(`${word} added automatically.`, "success");

  if (wordBuildEl) {
    wordBuildEl.classList.add("is-valid");
  }
  clearSelectionSoon(400);
}

// ── Board-Word Solver ────────────────────────────────────────────────────────
// Checks if `upperWord` can be traced as a valid path on the board.
// Uses a bitmask (16 bits) for visited cells — fast for 4×4 boards.
function canFormOnBoard(upperWord, board) {
  function dfs(charPos, lastIdx, visitedMask) {
    if (charPos === upperWord.length) return true;
    for (let i = 0; i < board.length; i++) {
      if (visitedMask & (1 << i)) continue;
      if (lastIdx !== -1 && !areAdjacent(board[lastIdx], board[i])) continue;
      const cellLetter = board[i].letter; // "A" or "QU"
      if (upperWord.startsWith(cellLetter, charPos)) {
        if (dfs(charPos + cellLetter.length, i, visitedMask | (1 << i))) return true;
      }
    }
    return false;
  }
  return dfs(0, -1, 0);
}

// Finds the longest valid dictionary word formable on the given board.
// Runs filter → sort → DFS check on top candidates.
function findLongestBoardWord(board) {
  if (!WORDS) return null;

  // Count each letter token available on the board
  const boardLetterCount = {};
  board.forEach((cell) => {
    for (const ch of cell.letter) { // "QU" contributes Q and U
      boardLetterCount[ch] = (boardLetterCount[ch] || 0) + 1;
    }
  });

  // Filter: keep only words whose letters are all present on the board
  const candidates = [];
  for (const word of Object.keys(WORDS)) {
    const len = word.length;
    if (len < 3 || len > 16) continue;
    const upper = word.toUpperCase();
    const needed = {};
    let possible = true;
    for (const ch of upper) {
      needed[ch] = (needed[ch] || 0) + 1;
      if (needed[ch] > (boardLetterCount[ch] || 0)) { possible = false; break; }
    }
    if (possible) candidates.push(word);
  }

  // Sort longest-first, then check up to 600 candidates via DFS
  candidates.sort((a, b) => b.length - a.length);
  for (const word of candidates.slice(0, 600)) {
    if (canFormOnBoard(word.toUpperCase(), board)) return word.toUpperCase();
  }
  return null;
}

function renderResults(room) {
  clearInterval(tickId);
  tickId = null;

  // ── Voting / auto-start ──
  const votes       = room.nextMatchVotes || [];
  const validVotes  = votes.filter((id) => room.players.some((p) => p.id === id));
  const voteCount   = validVotes.length;
  const totalPlayers = room.players.length;
  const hasVoted    = validVotes.includes(playerId);

  // Auto-start when all current players voted
  if (room.hostId === playerId && totalPlayers > 0 && voteCount >= totalPlayers) {
    setTimeout(startMatch, 80);
    return;
  }

  // Button label
  if (nextMatchButton) {
    nextMatchButton.disabled = hasVoted;
    nextMatchButton.textContent = hasVoted
      ? `Ready (${voteCount}/${totalPlayers})`
      : `Next Match (${voteCount}/${totalPlayers} ready)`;
  }

  // ── Build word frequency map for uniqueness bonus ──
  const allWords = room.players.flatMap((p) => p.words);

  // ── Calculate final scores with uniqueness bonus ──
  const playerFinalScores = room.players.map((p) => getFinalScore(p.words, room));
  const maxScore = Math.max(1, ...playerFinalScores);
  const winnerIndex = playerFinalScores.indexOf(Math.max(...playerFinalScores));
  const winner = room.players[winnerIndex];

  winnerLine.textContent = maxScore > 1 || (winner && winner.words.length > 0)
    ? `🏆 ${winner ? winner.name : "Nobody"} wins with ${Math.max(...playerFinalScores)} points!`
    : "No points were scored this round.";
  winnerLine.textContent = maxScore > 1 || (winner && winner.words.length > 0)
    ? `${winner ? winner.name : "Nobody"} wins with ${Math.max(...playerFinalScores)} points.`
    : "No points were scored this round.";

  // ── Signature guard — skip rebuild if data unchanged ──
  const signature = JSON.stringify({
    board: room.board,
    players: room.players.map((p) => [p.id, p.words])
  });
  if (signature === lastRevealSignature) {
    // Just update buttons
    if (revealComplete) {
      if (bestWordEl) bestWordEl.hidden = false;
      if (resultsActionsEl) resultsActionsEl.hidden = false;
    }
    return;
  }
  lastRevealSignature = signature;
  revealComplete = false;
  if (resultsActionsEl) resultsActionsEl.hidden = true;
  if (bestWordEl) bestWordEl.hidden = true;

  // ── Build result cards (only real players) ──
  clearInterval(revealId);
  resultsGrid.innerHTML = "";

  const players = room.players;

  players.forEach((player, pi) => {
    const card = document.createElement("article");
    const isWinner = winner && player.id === winner.id && playerFinalScores[pi] > 0;
    card.className = `result-card${isWinner ? " is-winner" : ""}`;
    card.style.animationDelay = `${pi * 60}ms`;
    card.innerHTML = `
      <div class="result-top">
        <strong class="player-name"></strong>
        <span class="count">0 pts</span>
      </div>
      <div class="word-count">0 of ${player.words.length} words counted</div>
      <div class="bar"><div class="bar-fill"></div></div>
      <div class="word-chips"></div>
    `;
    card.querySelector(".player-name").textContent = player.name;
    resultsGrid.append(card);
  });

  const cards = [...resultsGrid.querySelectorAll(".result-card")];
  let step = 0;
  const maxWords = Math.max(1, ...players.map((p) => p.words.length));

  revealId = setInterval(() => {
    step += 1;
    cards.forEach((card, pi) => {
      const revealedWords = players[pi].words.slice(0, step);
      const score = revealedWords.reduce((total, word) => total + getWordScore(word, allWords), 0);
      card.querySelector(".count").textContent = `${score} pts`;
      card.querySelector(".word-count").textContent =
        `${revealedWords.length} of ${players[pi].words.length} words counted`;
      card.querySelector(".bar-fill").style.width = `${(score / maxScore) * 100}%`;
      card.querySelector(".word-chips").innerHTML = revealedWords.map((word) => {
        const isUnique = allWords.filter((w) => w === word).length === 1;
        const pts = getWordScore(word, allWords);
        return `<span class="word-chip${isUnique ? " is-unique" : ""}">${word} (${pts} pt${isUnique ? ", unique" : ""})</span>`;
      }).join("");
    });

    if (step >= maxWords) {
      clearInterval(revealId);
      revealId = null;
      revealComplete = true;
      if (resultsActionsEl) resultsActionsEl.hidden = true;

      // Async best-word search — runs after animation, result appears below buttons
      setTimeout(() => {
        if (!room.board) return;
        const best = findLongestBoardWord(room.board);
        if (bestWordEl) {
          /*
          bestWordEl.textContent = best
            ? `🔤 Longest word on this board: ${best} (${best.length} letter${best.length !== 1 ? "s" : "})`
            : "No long words found on this board.";
          */
          bestWordEl.hidden = false;
          bestWordEl.textContent = best
            ? `Longest possible word on this board: ${best} (${best.length} letter${best.length !== 1 ? "s" : ""})`
            : "No long words found on this board.";
        }
        if (resultsActionsEl) resultsActionsEl.hidden = false;
      }, 200);
    }
  }, 420);
}

createRoomButton.addEventListener("click", () => createRoom());
lobbyForm.addEventListener("submit", joinRoom);
startMatchButton.addEventListener("click", startMatch);
leaveRoomButton.addEventListener("click", leaveRoom);
rematchButton.addEventListener("click", backToLobby);
nextMatchButton.addEventListener("click", () => {
  const room = readRoom();
  if (!room) return;
  const votes = room.nextMatchVotes || [];
  if (!votes.includes(playerId)) {
    room.nextMatchVotes = [...votes, playerId];
    writeRoom(room);
  }
});
window.addEventListener("pointermove", dragAcross);
window.addEventListener("pointerup", stopDrag);
window.addEventListener("pointercancel", stopDrag);
roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = normalizeCode(roomCodeInput.value);
});

window.addEventListener("storage", (event) => {
  if (!currentRoomCode || event.key !== roomKey()) return;
  render();
});

if (channel) {
  channel.addEventListener("message", (event) => {
    if (event.data.code === currentRoomCode) {
      render();
    }
  });
}

if (currentRoomCode && readRoom(currentRoomCode)) {
  render();
} else {
  render();
}
