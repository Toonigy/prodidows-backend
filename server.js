const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io with CORS for your frontend URL
const io = new Server(server, {
    cors: {
        origin: "*", // Or your specific frontend URL like "https://your-game.onrender.com"
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// --- BACKEND STATUS ROUTE ---
// This replaces the res.sendFile logic to prevent ENOENT errors
app.get('/', (req, res) => {
    res.json({
        status: "online",
        service: "Prodigy Definitive Edition Multiplayer Backend",
        activePlayers: Object.keys(players).length
    });
});

// --- WORLD DATA ---
const worlds = [
    { id: 1, name: "Farflight", maxPopulation: 100, status: "online" },
    { id: 2, name: "Pirate Bay", maxPopulation: 100, status: "online" },
    { id: 3, name: "Crystal Caverns", maxPopulation: 100, status: "online" },
    { id: 4, name: "Shiverchill", maxPopulation: 100, status: "online" }
];

const players = {}; 

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

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // WORLD LIST via WS
    // Triggered when client calls ApiClient.getWorldList
    socket.on('getWorldList', () => {
        socket.emit('worldListResponse', { worlds: getWorldsWithPopulation() });
    });

    // JOIN WORLD
    socket.on('joinWorld', (data) => {
        try {
            const { worldId, userID, appearance, x, y } = data;

            // Fix for 'undefined' userID issue
            if (!userID) {
                console.warn(`Blocked join from ${socket.id}: No userID provided.`);
                return;
            }

            socket.join(`world_${worldId}`);

            // Store full data (Appearance is required for rendering characters)
            players[socket.id] = {
                socketId: socket.id,
                userID,
                world: worldId,
                x: x || 0,
                y: y || 0,
                appearance: appearance || {} 
            };

            // Notify everyone of updated population
            io.emit('worldListUpdate', { worlds: getWorldsWithPopulation() });

            // Send list of neighbors to the joiner
            const neighbors = Object.values(players).filter(
                p => p.world === worldId && p.socketId !== socket.id
            );
            socket.emit('playerList', neighbors);

            // Broadcast the new player to the world (Including Appearance!)
            socket.to(`world_${worldId}`).emit('playerJoined', players[socket.id]);

            console.log(`User ${userID} joined world ${worldId}`);
        } catch (e) {
            console.error("Join Error:", e);
        }
    });

    // POSITION/ANIMATION UPDATES
    socket.on('updatePlayer', (data) => {
        const p = players[socket.id];
        if (p) {
            Object.assign(p, data);
            socket.to(`world_${p.world}`).emit('playerUpdate', p);
        }
    });

    // DISCONNECT
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
    console.log(`Backend listening on port ${PORT}`);
});
