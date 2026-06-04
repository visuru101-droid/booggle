const { WebSocketServer } = require("ws");

const wss = new WebSocketServer({ port: 8081 });
console.log("WebSocket server running on port 8081");

// In-memory store of active rooms
const rooms = new Map();
// Track client room memberships: ws -> roomCode
const clientRooms = new Map();

wss.on("connection", (ws) => {
  console.log("New client connected");

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === "join") {
        const { roomCode, playerId, playerName } = data;
        ws.roomCode = roomCode;
        ws.playerId = playerId;
        clientRooms.set(ws, roomCode);
        
        console.log(`Player ${playerName} (${playerId}) joined room ${roomCode}`);
        
        // If room doesn't exist, it will be initialized by the host writeRoom
        const currentRoom = rooms.get(roomCode);
        if (currentRoom) {
          ws.send(JSON.stringify({ type: "room-updated", room: currentRoom }));
        } else {
          ws.send(JSON.stringify({ type: "room-missing", roomCode }));
        }
      } 
      
      else if (data.type === "update") {
        const { room } = data;
        if (room && room.code) {
          rooms.set(room.code, room);
          // Broadcast to all clients in the same room
          broadcastToRoom(room.code, { type: "room-updated", room }, ws);
        }
      }
    } catch (err) {
      console.error("Error processing message:", err);
    }
  });

  ws.on("close", () => {
    const roomCode = clientRooms.get(ws);
    clientRooms.delete(ws);
    console.log("Client disconnected");
    // Optionally: We could clean up rooms if empty, but we let room owner host-management handle it.
  });
});

function broadcastToRoom(roomCode, data, senderWs) {
  const messageStr = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client !== senderWs && client.roomCode === roomCode && client.readyState === 1) {
      client.send(messageStr);
    }
  }
}
