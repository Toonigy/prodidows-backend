// server.js - A Node.js and Express server that handles both HTTP requests
// and WebSocket connections for a multi-world game, with a defined API.

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
// Use the PORT environment variable provided by platforms like Render, or default to 10000.
const PORT = process.env.PORT || 10000;

// Create a standard HTTP server. This server will handle the initial
// HTTP requests and also listen for 'upgrade' events for WebSockets.
const server = http.createServer(app);

// A map to hold different WebSocket server instances, one for each world.
const worldWebSocketServers = new Map();

// --- Game World Configuration ---
const worlds = [
  {
    name: "Fireplane",
    path: "/worlds/fireplane",
    icon: "fire",
    full: 0,
    players: {}, // We'll store player data here
  },
  {
    name: "Waterscape",
    path: "/worlds/waterscape",
    icon: "water",
    full: 0,
    players: {}, // We'll store player data here
  },
];

// --- Dedicated WebSocket Server for the World List ---
const worldListWss = new WebSocket.Server({ noServer: true });

worldListWss.on("connection", (ws) => {
  console.log(`🌐 Client connected to world list.`);
  ws.send(JSON.stringify({ type: "worlds", servers: worlds }));

  ws.on("message", (msg) => {
    console.log("📩 Message received on world list connection:", msg.toString());
  });

  ws.on("close", () => {
    console.log("❌ Client disconnected from world list.");
  });
});

// --- WebSocket Servers for Each Individual Game World ---
worlds.forEach((world) => {
  const wss = new WebSocket.Server({ noServer: true });
  worldWebSocketServers.set(world.path, wss);

  wss.on("connection", (ws, req) => {
    // Generate a unique ID for the new player.
    const playerId = `player_${Math.random().toString(36).substr(2, 9)}`;
    const player = {
      id: playerId,
      name: `Guest_${Math.floor(Math.random() * 1000)}`,
      x: Math.random() * 800,
      y: Math.random() * 600,
    };
    world.players[playerId] = player;
    world.full++;

    console.log(`🎮 Player '${player.name}' (${playerId}) connected to ${world.name}. Current players: ${world.full}`);

    // Immediately send the new player their ID and the current state of the world.
    ws.send(JSON.stringify({ type: "init", player, players: world.players }));

    // Broadcast a "playerJoined" event to all other clients in this world.
    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "playerJoined", player }));
      }
    });

    // Update the world list for clients on the main page.
    broadcastWorldListUpdate();

    // The main API for in-game interactions.
    ws.on("message", (msg) => {
      try {
        const data = JSON.parse(msg);
        switch (data.type) {
          case "chatMessage":
            // API: Client sends a chat message.
            // Server broadcasts it to all players in the world.
            if (data.message) {
              const chatBroadcast = {
                type: "chatMessage",
                sender: player.name,
                message: data.message,
              };
              wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify(chatBroadcast));
                }
              });
            }
            break;
          case "movePlayer":
            // API: Client sends new position data.
            // Server updates the player's position and broadcasts it.
            if (data.x !== undefined && data.y !== undefined) {
              world.players[playerId].x = data.x;
              world.players[playerId].y = data.y;

              const moveBroadcast = {
                type: "playerMoved",
                id: playerId,
                x: data.x,
                y: data.y,
              };
              wss.clients.forEach(client => {
                // Broadcast to all clients including the sender to ensure state consistency.
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify(moveBroadcast));
                }
              });
            }
            break;
          default:
            console.log(`📩 Unhandled message type from '${player.name}':`, data.type);
        }
      } catch (e) {
        console.error(`🚨 Invalid JSON received in ${world.name} world from '${player.name}':`, e);
      }
    });

    // --- Decrement player count on disconnection ---
    ws.on("close", () => {
      delete world.players[playerId];
      world.full--;
      console.log(`❌ Player '${player.name}' (${playerId}) disconnected from ${world.name}. Current players: ${world.full}`);

      // Broadcast a "playerLeft" event to all other clients in this world.
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: "playerLeft", id: playerId }));
        }
      });

      // Update the world list for clients on the main page.
      broadcastWorldListUpdate();
    });
  });
});

function broadcastWorldListUpdate() {
  const updatedWorlds = worlds.map(w => ({
    name: w.name,
    path: w.path,
    icon: w.icon,
    full: w.full
  }));
  worldListWss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "worlds", servers: updatedWorlds }));
    }
  });
}

// --- Express.js HTTP Server Setup ---
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- WebSocket Upgrade Logic ---
server.on("upgrade", (req, socket, head) => {
  if (req.url === "/game-api/worlds") {
    worldListWss.handleUpgrade(req, socket, head, (ws) => {
      worldListWss.emit("connection", ws, req);
    });
  } else {
    const wssInstance = worldWebSocketServers.get(req.url);
    if (wssInstance) {
      wssInstance.handleUpgrade(req, socket, head, (ws) => {
        wssInstance.emit("connection", ws, req);
      });
    } else {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
    }
  }
});

server.listen(PORT, () => {
  console.log(`✅ Server is listening on port ${PORT}`);
});
