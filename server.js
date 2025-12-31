const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// 1. STATIC FILE SERVING
// Serves everything in the 'public' folder (index.html, game.min.js, etc.)
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// 2. WORLD CONFIGURATION
const worlds = [
    { id: 1, name: "Farflight", maxPopulation: 100, status: "online" },
    { id: 2, name: "Pirate Bay", maxPopulation: 100, status: "online" },
    { id: 3, name: "Crystal Caverns", maxPopulation: 100, status: "online" },
    { id: 4, name: "Shiverchill", maxPopulation: 100, status: "online" }
];

// Active sessions stored by socket ID
const players = {}; 

/**
 * Helper: Formats world data for the game's UI
 */
function getWorldsWithPopulation() {
    return worlds.map(w => {
        const count = Object.values(players).filter(p => p.world === w.id).length;
        return { 
            ...w, 
            population: count,
            full: count / w.maxPopulation // Required for game's 'getSuggested' logic
        };
    });
}

// 3. SOCKET.IO EVENT HANDLERS
io.on('connection', (socket) => {
    console.log(`New Connection: ${socket.id}`);

    /**
     * Replacement for ApiClient.getWorldList HTTP call
     * The client should emit this when opening the world menu
     */
    socket.on('getWorldList', () => {
        socket.emit('worldListResponse', { worlds: getWorldsWithPopulation() });
    });

    /**
     * Joining a world
     * Fixes 'undefined' userID by checking validity before processing
     */
    socket.on('joinWorld', (data) => {
        try {
            const { worldId, userID, appearance, x, y } = data;

            if (!userID) {
                console.error(`Rejected Join: UserID is missing from socket ${socket.id}`);
                socket.emit('error_message', { text: "Login required for multiplayer" });
                return;
            }

            socket.join(`world_${worldId}`);

            // Save player data including appearance (needed to draw the sprite)
            players[socket.id] = {
                socketId: socket.id,
                userID: userID,
                world: worldId,
                x: x || 0,
                y: y || 0,
                appearance: appearance || {} 
            };

            // Get existing players in this specific world
            const othersInWorld = Object.values(players).filter(
                p => p.world === worldId && p.socketId !== socket.id
            );

            // Tell the joiner who else is here
            socket.emit('playerList', othersInWorld);

            // Tell everyone else in this world a new player appeared
            // Sending the WHOLE object ensures other clients can render the clothes/hair
            socket.to(`world_${worldId}`).emit('playerJoined', players[socket.id]);

            // Refresh population data for everyone in the lobby
            io.emit('worldListUpdate', { worlds: getWorldsWithPopulation() });

            console.log(`Player ${userID} entered world ${worldId}`);
        } catch (err) {
            console.error("Socket Join Error:", err);
        }
    });

    /**
     * Position & Appearance Updates
     */
    socket.on('updatePlayer', (data) => {
        const p = players[socket.id];
        if (p) {
            Object.assign(p, data); 
            // Broadcast the update to the specific world room
            socket.to(`world_${p.world}`).emit('playerUpdate', p);
        }
    });

    /**
     * Cleanup on Disconnect
     */
    socket.on('disconnect', () => {
        const p = players[socket.id];
        if (p) {
            socket.to(`world_${p.world}`).emit('playerLeft', { userID: p.userID, socketId: socket.id });
            delete players[socket.id];
            
            // Update populations in real-time
            io.emit('worldListUpdate', { worlds: getWorldsWithPopulation() });
        }
        console.log(`Disconnected: ${socket.id}`);
    });
});

// 4. RENDER FIX: Root Route Handling
// If the user visits the root or any subpath, serve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

// 5. SERVER START
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
