// server.js
// This file is configured as a Node.js backend, optimized for deployment on platforms like Render,
// and primarily focuses on providing WebSocket (both raw and Socket.IO) connectivity.

const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const WebSocket = require("ws"); // Used for handling raw WebSocket connections
const { Server } = require("socket.io"); // Used for handling Socket.IO connections and namespaces

const app = express();
const PORT = process.env.PORT || 10000; // Use environment variable for port, fallback to 10000

// Explicitly create an HTTP server. Render's proxy handles HTTPS and forwards to HTTP.
let server = http.createServer(app);
console.warn("Server is running in HTTP-only mode (optimized for Render deployment).");

// ⭐ Configure CORS options for both HTTP and Socket.IO requests. ⭐
// This allows your client (e.g., from localhost or other domains) to connect.
const corsOptions = {
    origin: '*', // Allow all origins for debugging. For production, specify your client's domain.
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Explicitly allow common HTTP methods
    allowedHeaders: ['Content-Type', 'Authorization', 'auth-key', 'token'], // Explicitly allow necessary headers
    credentials: true // Allow cookies or authorization headers to be sent cross-origin
};

// Apply CORS middleware to Express app for HTTP requests
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Handle preflight requests for all routes

// Serve static files from the 'public' folder (e.g., your index.html, game assets)
app.use(express.static(path.join(__dirname, "public")));
// Middleware to parse JSON request bodies (for POST requests like game events)
app.use(express.json());

// --- ⭐ Core Game Worlds Definition ⭐ ---
// Define the various game worlds and their initial properties directly within the server.
const worlds = [
    { id: "world-fireplane-1", name: "Fireplane", path: "/worlds/fireplane", full: 0 },
    { id: "world-icepeak-1", name: "Icepeak", path: "/worlds/icepeak", full: 0 },
    { id: "world-mystic-1", name: "Mystic Realm", path: "/worlds/mystic", full: 0 },
    { id: "world-town-1", name: "Town Square", path: "/worlds/town", full: 0 }
];

// --- ⭐ HTTP Routes ⭐ ---
// Route to serve your main index.html file
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// HTTP GET endpoint for clients still expecting the world list via HTTP (for compatibility).
app.get("/game-api/v2/worlds", (req, res) => {
    console.log(`\n--- World List API Request (via HTTP GET /game-api/v2/worlds) ---`);
    console.log(`Received GET request for the world list.`);
    
    // Send a simplified list of worlds to the client. Player count is a placeholder for HTTP.
    const simplifiedWorlds = worlds.map(world => ({
        id: world.id,
        path: world.path,
        name: world.name,
        full: 0 // Placeholder for player count in HTTP response.
    }));
    
    res.status(200).json(simplifiedWorlds);
    console.log(`Responded with ${simplifiedWorlds.length} worlds via HTTP.`);
    console.log(`-----------------------------------------------------------\n`);
});

// --- ⭐ Raw WebSocket Server (for generic WebSocket clients/testers) ⭐ ---
// This server handles raw WebSocket connections on the root path ('/').
// It's created with `noServer: true` so it can be integrated with the existing HTTP server.
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', ws => {
    console.log(`\n--- Raw WebSocket Connection ---`);
    console.log(`A raw WebSocket client connected.`);
    
    // Upon connection, immediately send the world list to the raw WebSocket client.
    ws.send(JSON.stringify({ type: 'worldList', data: worlds.map(world => ({
        id: world.id,
        path: world.path,
        name: world.name,
        full: world.full
    })) }));
    console.log(`Sent world list to raw WebSocket client.`);
    console.log(`------------------------------\n`);

    ws.on('message', message => {
        console.log(`Received raw WebSocket message: ${message}`);
        // Add custom logic here to handle messages from raw WebSocket clients if needed.
    });

    ws.on('close', () => {
        console.log('Raw WebSocket client disconnected.');
    });

    ws.on('error', error => {
        console.error('Raw WebSocket error:', error);
    });
});

// --- ⭐ Socket.IO Server (for game clients) ⭐ ---
// This initializes the Socket.IO server, attaching it to the HTTP server.
const io = new Server(server, {
    cors: corsOptions, // Apply CORS options for Socket.IO
    path: "/socket.io/", // Explicitly specify the base path for Socket.IO connections
    allowEIO3: true // Crucial for compatibility with older Socket.IO clients (e.g., v1.x with EIO=3)
});

// Handle the main Socket.IO connection (for initial handshake and general client events).
io.on("connection", (socket) => {
    console.log(`\n--- Main Socket.IO Connection ---`);
    console.log(`A Socket.IO client connected to the main server (Socket.ID: ${socket.id}).`);

    // Emit the world list immediately upon a new Socket.IO client connecting.
    socket.emit("worldList", worlds.map(world => ({
        id: world.id,
        path: world.path,
        name: world.name,
        full: world.full
    })));
    console.log(`Sent world list to Socket.IO client ${socket.id} via WebSocket.`);
    console.log(`-----------------------------------\n`);

    // Listener for client-side logs (emitted via Util.log in game.min.js patch).
    socket.on("clientLog", (logData) => {
        const { message, level, timestamp, clientSide, additionalData } = logData;
        console.log(`\n--- Client Log [${level.toUpperCase()}] (${timestamp}) ---`);
        console.log(`Message: ${message}`);
        if (additionalData) {
            try {
                console.log(`Data:`, JSON.parse(additionalData));
            } catch (error) {
                console.log(`Data (raw): ${additionalData}`);
            }
        }
        console.log(`Source: Client-side (Socket ID: ${socket.id})`);
        console.log(`-------------------------------------------\n`);
    });

    socket.on("disconnect", (reason) => {
        console.log(`Main Socket.IO client disconnected (Socket.ID: ${socket.id}). Reason: ${reason}`);
    });
});

// --- ⭐ Socket.IO Namespaces for Individual Game Worlds ⭐ ---
// Create and configure a distinct Socket.IO namespace for each defined game world.
worlds.forEach(world => {
    const namespace = io.of(world.path); // Define namespace based on world's path
    world.playerCount = 0; // Initialize player count for this world
    world.players = {}; // Map to store player data specific to this world

    console.log(`🚀 Socket.IO Namespace created for world: "${world.name}" (Path: ${world.path})`);

    // Listen for connections to this specific world's namespace.
    namespace.on("connection", (socket) => {
        const requestPath = socket.handshake.url;
        const userId = socket.handshake.query.userId;
        const worldId = socket.handshake.query.worldId;
        const userToken = socket.handshake.query.userToken;

        // Log when a user attempts to connect to this multiplayer world.
        console.log(`\n--- Multiplayer Connection Attempt ---`);
        console.log(`Attempting connection to world "${world.name}" (Path: ${world.path})`);
        console.log(`Client IP: ${socket.handshake.address}`);
        console.log(`UserID: ${userId || 'N/A'}`);
        console.log(`User Token (truncated): ${userToken ? userToken.substring(0, 20) + '...' : 'N/A'}`);
        console.log(`Full Request URL: ${requestPath}`);
        console.log(`------------------------------------\n`);

        // Log successful connection to the world namespace.
        console.log(`\n--- World Namespace Connection ---`);
        console.log(`✅ User ${userId} connected to world "${world.name}" with Socket.ID: ${socket.id}`);
        console.log(`----------------------------------\n`);

        // Basic validation for required query parameters.
        if (!userId || !userToken) {
            console.error("Connection aborted: Missing userId or userToken in handshake query. Check client-side ApiClient.js for correct query parameters.");
            socket.disconnect(true);
            return;
        }

        // Add user to the player list for this specific world.
        world.playerCount++;
        world.players[userId] = {
            id: userId,
            socketId: socket.id,
            joinedAt: new Date()
        };

        // Broadcast 'playerJoined' event to all other clients in this world's namespace.
        socket.broadcast.emit("playerJoined", world.players[userId]);
        // Send the full player list to the newly connected client.
        socket.emit("playerList", Object.values(world.players));

        // Handle incoming messages specific to this world's namespace.
        socket.on("message", (message) => {
            console.log(`📩 Message from ${userId} in world "${world.name}":`, message);
            // Example: Broadcast the message to all other players in this world.
            socket.broadcast.emit("message", { userId, message });
        });

        // Handle client disconnection from this world's namespace.
        socket.on("disconnect", (reason) => {
            console.log(`\n--- Disconnection from World Namespace ---`);
            console.log(`User ${userId} (Socket.ID: ${socket.id}) disconnected from world "${world.name}". Reason: ${reason}`);
            console.log(`------------------------------------------\n`);

            // Remove user from player list if they were fully joined.
            if (world.players[userId]) {
                delete world.players[userId];
                world.playerCount--;
                // Broadcast 'playerLeft' event to remaining clients in this world.
                socket.broadcast.emit("playerLeft", userId);
            }
        });
    });
});

// ⭐ Handle the 'upgrade' event for both raw WebSockets and Socket.IO. ⭐
// This is crucial for allowing the single HTTP server to manage both types of WebSocket connections.
server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

    // If the request path is for Socket.IO, let Socket.IO handle the upgrade.
    if (pathname === '/socket.io/') {
        io.engine.handleUpgrade(request, socket, head);
    } else {
        // Otherwise, attempt to handle it as a raw WebSocket connection.
        // This allows generic WebSocket testers to connect to the root path '/'.
        wss.handleUpgrade(request, socket, head, ws => {
            wss.emit('connection', ws, request);
        });
    }
});

// --- Server Startup ---
// Start the HTTP server, which also manages WebSocket upgrades.
server.listen(PORT, () => {
    console.log(`\n--- Server Startup ---`);
    console.log(`✅ Server is listening on port ${PORT}...`);
    console.log(`🌐 Serving HTTP, Raw WebSockets (on /), & Socket.IO (on /socket.io/ and /worlds/*).`);
    console.log(`Defined worlds (Socket.IO Namespaces):`);
    worlds.forEach(world => {
        console.log(`  - ${world.name} (Path: ${world.path})`);
    });
    console.log(`-------------------------\n`);
});
