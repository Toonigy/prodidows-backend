// server.js - A Node.js and Express server that handles both HTTP requests
// and WebSocket connections for a multi-world game.

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
// This array defines our game worlds. The `full` property will be
// dynamically updated based on the number of connections.
const worlds = [
  {
    name: "Fireplane",
    path: "/worlds/fireplane",
    icon: "fire",
    full: 0,
  },
  {
    name: "Waterscape",
    path: "/worlds/waterscape",
    icon: "water",
    full: 0,
  },
];

// --- Dedicated WebSocket Server for the World List ---
// This WebSocket server handles clients that are just looking at the
// list of available worlds. We use `noServer: true` because it will
// be attached to our main HTTP server's 'upgrade' event listener.
const worldListWss = new WebSocket.Server({ noServer: true });

worldListWss.on("connection", (ws) => {
  console.log(`🌐 Client connected to world list.`);
  // Immediately send the current list of worlds to the new client.
  ws.send(JSON.stringify({ type: "worlds", servers: worlds }));

  // This WebSocket is for the world list, so it doesn't need to handle
  // complex in-game messages. It will listen for simple messages if needed.
  ws.on("message", (msg) => {
    console.log("📩 Message received on world list connection:", msg.toString());
  });

  // When a client for the world list disconnects, we log it.
  ws.on("close", () => {
    console.log("❌ Client disconnected from world list.");
  });
});

// --- WebSocket Servers for Each Individual Game World ---
// We loop through our defined worlds and create a WebSocket server for each.
worlds.forEach((world) => {
  const wss = new WebSocket.Server({ noServer: true });
  worldWebSocketServers.set(world.path, wss);

  wss.on("connection", (ws) => {
    // --- Increment player count on new connection ---
    world.full++;
    console.log(`🎮 Player connected to ${world.name}. Current players: ${world.full}`);

    // Broadcast the updated world list to all clients of the world list server.
    broadcastWorldListUpdate();

    // Handle messages from the client specific to this game world.
    ws.on("message", (msg) => {
      try {
        const data = JSON.parse(msg);
        if (data.type === "login" && data.userId) {
          console.log(`✅ User logged in to ${world.name}: ${data.userId}`);
        }
      } catch (e) {
        console.error(`🚨 Invalid message received in ${world.name} world:`, e);
      }
    });

    // --- Decrement player count on disconnection ---
    ws.on("close", () => {
      world.full--;
      console.log(`❌ Player disconnected from ${world.name}. Current players: ${world.full}`);
      // Broadcast the updated world list again to reflect the player count change.
      broadcastWorldListUpdate();
    });
  });
});

// A helper function to broadcast the current list of worlds to all
// clients connected to the world list WebSocket server.
function broadcastWorldListUpdate() {
  worldListWss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "worlds", servers: worlds }));
    }
  });
}

// --- Express.js HTTP Server Setup ---
// Serve static files from a 'public' folder.
app.use(express.static(path.join(__dirname, "public")));

// Serve `index.html` for the root URL.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- WebSocket Upgrade Logic ---
// This is the crucial part that links the HTTP server to our
// WebSocket servers. It listens for a client trying to 'upgrade'
// an HTTP connection to a WebSocket connection.
server.on("upgrade", (req, socket, head) => {
  // Check if the requested URL is for the world list.
  if (req.url === "/game-api/worlds") {
    // If it is, handle the upgrade with the world list WebSocket server.
    worldListWss.handleUpgrade(req, socket, head, (ws) => {
      worldListWss.emit("connection", ws, req);
    });
  } else {
    // If not the world list, check if the URL matches a game world path.
    const wssInstance = worldWebSocketServers.get(req.url);
    if (wssInstance) {
      // If a match is found, handle the upgrade with that world's WebSocket server.
      wssInstance.handleUpgrade(req, socket, head, (ws) => {
        wssInstance.emit("connection", ws, req);
      });
    } else {
      // If no match, reject the upgrade request with a 404 error.
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
    }
  }
});

// Start the HTTP server and have it listen on the specified port.
server.listen(PORT, () => {
  console.log(`✅ Server is listening on port ${PORT}`);
});
