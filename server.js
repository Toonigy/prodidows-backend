const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Enable Socket.io with permissive CORS for Render cross-domain communication
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// --- WORLD DATA DEFINITION ---
const worlds = [
    { id: 1, name: "Farflight", maxPopulation: 100, status: "online" },
    { id: 2, name: "Pirate Bay", maxPopulation: 100, status: "online" },
    { id: 3, name: "Crystal Caverns", maxPopulation: 100, status: "online" },
    { id: 4, name: "Shiverchill", maxPopulation: 100, status: "online" },
    { id: 5, name: "Skywatch", maxPopulation: 100, status: "online" }
];

const players = {}; 

/**
 * Helper: Calculates population and "fullness" for the game's UI
 */
function getWorldsWithPopulation() {
    return worlds.map(w => {
        const count = Object.values(players).filter(p => p.world === w.id).length;
        return { 
            ...w, 
            population: count,
            full: count / w.maxPopulation 
        };
    });
}

// --- HTTP ENDPOINTS (To fix the 404 errors) ---

// This handles the GET request the game makes before/during world selection
app.all(['/game-api/v1/worlds', '/v1/worlds', '/worlds'], (req, res) => {
    console.log("HTTP: World list requested");
    res.json({ worlds: getWorldsWithPopulation() });
});

// Basic health check
app.get('/', (req, res) => {
    res.json({ status: "online", activePlayers: Object.keys(players).length });
});

// --- SOCKET.IO MULTIPLAYER LOGIC ---

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // WebSocket replacement for the World List
    socket.on('getWorldList', () => {
        socket.emit('worldListResponse', { worlds: getWorldsWithPopulation() });
    });

    // Handle Player Joining
    socket.on('joinWorld', (data) => {
        try {
            const { worldId, userID, appearance, x, y } = data;

            // RACE CONDITION FIX: If Firebase isn't ready, userID is undefined.
            if (!userID) {
                console.warn(`Join blocked: userID undefined for socket ${socket.id}`);
                return;
            }

            socket.join(`world_${worldId}`);

            // Store full data. 'appearance' is CRITICAL for rendering other players.
            players[socket.id] = {
                socketId: socket.id,
                userID: userID,
                world: worldId,
                x: x || 0,
                y: y || 0,
                appearance: appearance || {} 
            };

            // 1. Send existing players to the joiner
            const neighbors = Object.values(players).filter(
                p => p.world === worldId && p.socketId !== socket.id
            );
            socket.emit('playerList', neighbors);

            // 2. Tell neighbors a new player arrived (send WHOLE object)
            socket.to(`world_${worldId}`).emit('playerJoined', players[socket.id]);

            // 3. Update world populations for everyone
            io.emit('worldListUpdate', { worlds: getWorldsWithPopulation() });

            console.log(`Player ${userID} joined world ${worldId}`);
        } catch (e) {
            console.error("Join Error:", e);
        }
    });

    // Movement/Animation Updates
    socket.on('updatePlayer', (data) => {
        const p = players[socket.id];
        if (p && p.world) {
            Object.assign(p, data);
            socket.to(`world_${p.world}`).emit('playerUpdate', p);
        }
    });

    // Disconnect Cleanup
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
    console.log(`Multiplayer Backend running on port ${PORT}`);
});
