const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Enable Socket.io with permissive CORS for cross-domain communication
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// --- 1. GAME-EVENT HANDLER (Fixes the 404 Error) ---
app.all(['/game-event', '/v1/game-event', '/game-api/v1/game-event'], (req, res) => {
    res.status(200).send('OK');
});

// --- 2. WORLD LIST HTTP ENDPOINT (Fallback) ---
// This handles the initial world list request
app.all(['/game-api/v1/worlds', '/v1/worlds', '/worlds'], (req, res) => {
    // IMPORTANT: The game's ApiClient expects an object with a 'worlds' key.
    // The patch's callback expects this object to pass it to the UI.
    res.json({ worlds: getWorldsWithPopulation() });
});

// Health check route
app.get('/', (req, res) => {
    res.json({ status: "online", activePlayers: Object.keys(players).length });
});

// --- 3. WORLD DATA ---
const worlds = [
    { id: 1, name: "Farflight", maxPopulation: 100, status: "online" },
    { id: 2, name: "Pirate Bay", maxPopulation: 100, status: "online" },
    { id: 3, name: "Crystal Caverns", maxPopulation: 100, status: "online" },
    { id: 4, name: "Shiverchill", maxPopulation: 100, status: "online" },
    { id: 5, name: "Skywatch", maxPopulation: 100, status: "online" }
];

const players = {}; 

function getWorldsWithPopulation() {
    return worlds.map(w => {
        const count = Object.values(players).filter(p => p.world === w.id).length;
        // 'full' must be a number (0.0 to 1.0) for the game's sort logic (e.full - t.full)
        return { 
            ...w, 
            population: count,
            full: count / w.maxPopulation 
        };
    });
}

// --- 4. SOCKET.IO MULTIPLAYER LOGIC ---

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // WS replacement for World List
    socket.on('getWorldList', () => {
        // Must emit the SAME structure as the HTTP response
        socket.emit('worldListResponse', { worlds: getWorldsWithPopulation() });
    });

    // Handle Join World
    socket.on('joinWorld', (data) => {
        try {
            const { worldId, userID, appearance, x, y } = data;

            // RACE CONDITION: If userID is undefined, Firebase isn't ready.
            if (!userID) {
                console.warn(`Join blocked: userID is undefined for ${socket.id}`);
                return;
            }

            socket.join(`world_${worldId}`);

            // Store player data. Appearance is CRITICAL for rendering characters.
            players[socket.id] = {
                socketId: socket.id,
                userID: userID,
                world: worldId,
                x: x || 0,
                y: y || 0,
                appearance: appearance || {} 
            };

            // 1. Tell everyone else in this world a new player appeared
            // We send the WHOLE object so they have the Appearance data
            socket.to(`world_${worldId}`).emit('playerJoined', players[socket.id]);

            // 2. Send list of existing players in that world back to the joiner
            const neighbors = Object.values(players).filter(
                p => p.world === worldId && p.socketId !== socket.id
            );
            socket.emit('playerList', neighbors);

            // 3. Update world populations for everyone in lobby
            io.emit('worldListUpdate', { worlds: getWorldsWithPopulation() });

            console.log(`Player ${userID} joined world ${worldId}`);
        } catch (e) {
            console.error("Join Error:", e);
        }
    });

    // Handle Movement/Appearance Updates
    socket.on('updatePlayer', (data) => {
        const p = players[socket.id];
        if (p && p.world) {
            Object.assign(p, data);
            socket.to(`world_${p.world}`).emit('playerUpdate', p);
        }
    });

    // Handle Disconnect
    socket.on('disconnect', () => {
        const p = players[socket.id];
        if (p) {
            socket.to(`world_${p.world}`).emit('playerLeft', { userID: p.userID, socketId: socket.id });
            delete players[socket.id];
            io.emit('worldListUpdate', { worlds: getWorldsWithPopulation() });
        }
        console.log(`Socket disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Multiplayer Backend listening on port ${PORT}`);
});
