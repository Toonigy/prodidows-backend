const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

// --- WORLD DATA ---
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
        // The game specifically uses the 'full' property (0 to 1) for its sort logic
        return { 
            ...w, 
            population: count,
            full: count / w.maxPopulation 
        };
    });
}

// --- HTTP ROUTES (Fixes 404s and provides backup) ---
app.all(['/game-api/v1/worlds', '/v1/worlds'], (req, res) => {
    res.json({ worlds: getWorldsWithPopulation() });
});

app.get('/', (req, res) => {
    res.json({ status: "online", active: Object.keys(players).length });
});

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    
    // Response for the patched getWorldList
    socket.on('getWorldList', () => {
        socket.emit('worldListResponse', { worlds: getWorldsWithPopulation() });
    });

    socket.on('joinWorld', (data) => {
        try {
            const { worldId, userID, appearance, x, y } = data;
            if (!userID) return;

            socket.join(`world_${worldId}`);
            players[socket.id] = {
                socketId: socket.id,
                userID,
                world: worldId,
                x: x || 0,
                y: y || 0,
                appearance: appearance || {} 
            };

            // Send neighbors to joiner
            const neighbors = Object.values(players).filter(p => p.world === worldId && p.socketId !== socket.id);
            socket.emit('playerList', neighbors);

            // Broadcast join with full appearance so they are visible
            socket.to(`world_${worldId}`).emit('playerJoined', players[socket.id]);
            
            // Sync world list populations
            io.emit('worldListUpdate', { worlds: getWorldsWithPopulation() });
        } catch (e) { console.error(e); }
    });

    socket.on('updatePlayer', (data) => {
        const p = players[socket.id];
        if (p) {
            Object.assign(p, data);
            socket.to(`world_${p.world}`).emit('playerUpdate', p);
        }
    });

    socket.on('disconnect', () => {
        const p = players[socket.id];
        if (p) {
            socket.to(`world_${p.world}`).emit('playerLeft', { userID: p.userID });
            delete players[socket.id];
            io.emit('worldListUpdate', { worlds: getWorldsWithPopulation() });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
