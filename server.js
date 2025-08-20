const express = require("express");
const http = require("http");
const https = require("https"); // Import https module for WSS
const fs = require("fs");     // Import fs module for file system operations
const cors = require("cors"); // Re-add cors for API endpoints
const path = require("path");
const World = require("./World"); // Import the World class.
// Removed: const WorldSystem = require("./WorldSystem"); // WorldSystem is no longer directly used for Socket.IO connection handling here

const app = express();
const PORT = process.env.PORT || 10000;

let server; // Declare server variable outside try/catch

// --- SSL/TLS Certificate Configuration (for WSS) ---
// For local development, you need to generate self-signed certificates.
// Make sure 'cert.pem' and 'key.pem' files exist in a 'certs' folder in your project root.
const privateKeyPath = path.join(__dirname, 'certs', 'key.pem');
const certificatePath = path.join(__dirname, 'certs', 'cert.pem');

try {
  // Check if certificate files exist before creating HTTPS server
  if (fs.existsSync(privateKeyPath) && fs.existsSync(certificatePath)) {
    const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
    const certificate = fs.readFileSync(certificatePath, 'utf8');
    const credentials = { key: privateKey, cert: certificate };

    // Create an HTTPS server
    server = https.createServer(credentials, app);
    console.log("HTTPS server created. Ready for WSS connections.");
  } else {
    // Fallback to HTTP if certificates are not found
    console.warn("SSL/TLS certificates (key.pem, cert.pem) not found in 'certs/' folder.");
    console.warn("Starting HTTP server instead of HTTPS. WebSocket will be WS, not WSS.");
    server = http.createServer(app);
  }
} catch (error) {
  console.error("Error setting up HTTPS server, falling back to HTTP:", error);
  // Ensure server is still defined as HTTP in case of an error during HTTPS setup
  server = http.createServer(app);
}


// ⭐ CORS FIX: Explicitly allow all origins ⭐
app.use(cors({ origin: '*' })); // Configure CORS to allow all origins
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json()); // Middleware to parse JSON request bodies

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ⭐ Removed: Socket.IO Server Setup (as World.js uses raw WebSockets) ⭐
// const { Server } = require("socket.io"); 
// const io = new Server(server, { /* ... */ });
// console.warn("Socket.IO server setup complete. Using HTTP/HTTPS as determined.");


// --- HTTP Endpoints for API Calls ---

// HTTP GET endpoint for World List at /v2/worlds
app.get("/v2/worlds", (req, res) => {
    console.log(`\n--- World List GET Request (via /v2/worlds) ---`);
    console.log(`Received GET request for /v2/worlds from IP: ${req.ip}`);

    // Get the simplified list of all worlds
    const simplifiedWorlds = World.allWorlds.map(world => world.toSimplifiedObject());

    // Send the simplified world list as a JSON response
    res.status(200).json(simplifiedWorlds);
    console.log(`Responded to /v2/worlds GET with ${simplifiedWorlds.length} worlds.`);
});


// HTTP GET endpoint for World List (kept for backward compatibility if needed)
app.get("/game-api/v1/world-list", (req, res) => {
    console.log(`\n--- World List GET Request (via /game-api/v1/world-list) ---`);
    console.log(`Received GET request for /game-api/v1/world-list from IP: ${req.ip}`);

    // Get the simplified list of all worlds
    const simplifiedWorlds = World.allWorlds.map(world => world.toSimplifiedObject());

    // Send the simplified world list as a JSON response
    res.status(200).json(simplifiedWorlds);
    console.log(`Responded to world list GET with ${simplifiedWorlds.length} worlds.`);
});

// HTTP POST for game events (e.g., /game-api/v1/log-event)
app.post("/game-api/v1/log-event", (req, res) => {
    console.log(`\n--- Game Event POST Request ---`);
    console.log(`Received POST request for /game-api/v1/log-event from IP: ${req.ip}`);
    console.log(`Request Body (Game Event Data):`, JSON.stringify(req.body, null, 2));
    res.status(200).json({ status: "received", message: "Game event logged." });
    console.log(`Responded to game event POST.`);
});

// HTTP POST for matchmaking (e.g., startMatchmaking)
app.post("/game-api/v1/matchmaking-api/begin", (req, res) => {
    console.log(`\n--- Matchmaking POST Request ---`);
    console.log(`Received POST request for /game-api/v1/matchmaking-api/begin from IP: ${req.ip}`);
    console.log(`Matchmaking Data:`, JSON.stringify(req.body, null, 2));

    // Simulate matchmaking logic here (e.g., find a match, or put player in a queue)
    // For now, just send a success response.
    res.status(200).json({ status: "success", message: "Matchmaking request received." });
    console.log(`Responded to matchmaking POST.`);
});


// --- Raw WebSocket (WS/WSS) Connection Handling ---
// This map holds the individual ws.WebSocket.Server instances for each world.
// These are created within the World class itself (World.wss).
const worldWebSocketServers = new Map();

// Initialize the WebSocket servers for each world.
World.allWorlds.forEach(world => {
  // The World class instance holds its own wss (WebSocket.Server) instance.
  worldWebSocketServers.set(world.path, world.wss);
});

// ⭐ IMPORTANT: Handle the 'upgrade' event for raw WebSockets (WS/WSS) ⭐
// This is where the HTTP/HTTPS connection is "upgraded" to a WebSocket connection.
server.on("upgrade", (req, socket, head) => {
  // Parse the URL to get the path (e.g., '/worlds/fireplane') without query parameters
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`); // Use a base URL for parsing
  const requestPath = parsedUrl.pathname;

  // Find the correct World's WebSocket Server instance for this path
  const wssInstance = worldWebSocketServers.get(requestPath);

  if (wssInstance) {
    // Delegate the upgrade handling to the specific World's WebSocket server.
    // The World's wss instance will then emit its 'connection' event.
    wssInstance.handleUpgrade(req, socket, head, (ws) => {
      // Pass the WebSocket instance (ws) and the original request (req)
      // to the World's custom connection handler (defined in World.js)
      wssInstance.emit("connection", ws, req); 
    });
  } else {
    // If no matching world path, destroy the socket.
    console.warn(`\n--- WebSocket Upgrade Warning ---`);
    console.warn(`No World WebSocket server found for path: ${requestPath}. Destroying socket.`);
    socket.destroy();
    console.log(`---------------------------------\n`);
  }
});


// --- Server Startup ---
server.listen(PORT, () => {
    console.log(`\n--- Server Startup ---`);
    console.log(`✅ Server is listening on port ${PORT}...`);
    // Check if it's an HTTPS server for the console log
    if (server instanceof https.Server) {
      console.log(`🌐 HTTP/HTTPS endpoints for world list, status, game events, and matchmaking are online.`);
      console.log(`🚀 WSS server is online and ready for game world connections.`);
    } else {
      console.log(`🌐 HTTP endpoints for world list, status, game events, and matchmaking are online.`);
      console.log(`🚀 WS server is online and ready for game world connections.`);
    }
    console.log(`Defined worlds:`);
    World.allWorlds.forEach(world => {
        console.log(`  - ID: ${world.id}, Name: "${world.name}", Path: "${world.path}"`);
    });
    console.log(`-----------------------\n`);
});
