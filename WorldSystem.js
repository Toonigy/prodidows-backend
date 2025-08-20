// WorldSystem.js

const World = require("./World"); // Ensure World class is imported
// Removed: const WebSocket = require("ws"); // Not needed for Socket.IO compatibility

class WorldSystem {
    constructor(world) {
        this.world = world; // Store the World instance this system manages
        // Map: userId -> { socket (Socket.IO instance), wizardData, currentZone }
        this.connectedPlayers = new Map(); // To manage Socket.IO clients for this world
        this.world.playerCount = 0; // Initialize player count for this world system

        console.log(`ЁЯМН WorldSystem: Initializing for world "${this.world.name}" (Path: ${this.world.path})`);
        
        // Removed: this.wss = new WebSocket.Server({ noServer: true });
        // Removed: this.wss.on('connection', (ws, req) => { ... });
        // This is now handled by the main Socket.IO server in server.js,
        // which then calls handleConnection directly with the Socket.IO socket.
    }

    /**
     * Handles a new Socket.IO connection for a client joining this world.
     * @param {SocketIO.Socket} socket - The Socket.IO socket instance for the client.
     */
    handleConnection(socket) {
        // Socket.IO's handshake.query provides access to URL query parameters
        const userId = socket.handshake.query.userId;
        const worldId = socket.handshake.query.worldId;
        const zone = socket.handshake.query.zone || "unknown";
        const userToken = socket.handshake.query.userToken; // Not directly used here, but good to have

        if (!userId || !worldId) {
            console.error(`WorldSystem.handleConnection: Missing userId or worldId in handshake query. Disconnecting socket.`);
            socket.emit("connect_error", "Missing userId or worldId.");
            socket.disconnect(true);
            return;
        }

        if (this.world.playerCount >= this.world.maxPlayers) {
            console.warn(`World ${this.world.name} is full. Disconnecting user ${userId}.`);
            socket.emit("worldFull", { message: "World is full." });
            socket.disconnect(true);
            return;
        }

        // Store the connected player's Socket.IO socket and data
        this.connectedPlayers.set(userId, { socket: socket, userId: userId, wizardData: null, currentZone: zone });
        this.world.playerCount++; // Increment player count for this world
        console.log(`🌐 User ${userId} (Socket.ID: ${socket.id}) connected to ${this.world.name}. Current players: ${this.world.playerCount}`);

        // ⭐ Handle incoming 'message' events from this specific Socket.IO client ⭐
        socket.on("message", (messageData) => {
            try {
                const data = typeof messageData === 'string' ? JSON.parse(messageData) : messageData;
                // console.log(`➡️ Message from ${userId} in world ${this.world.id}:`, data); // For verbose logging

                if (data.type === "joinGameWorld") {
                    const playerEntry = this.connectedPlayers.get(userId);
                    if (playerEntry) {
                        playerEntry.wizardData = data.wizardData;
                        playerEntry.currentZone = data.zone; // Update zone if client specifies on join
                        this.connectedPlayers.set(userId, playerEntry); // Update map entry

                        // ⭐ Send confirmation back to the client that they've joined ⭐
                        socket.emit("worldJoinedConfirmed", {
                            worldId: this.world.id,
                            zoneId: playerEntry.currentZone,
                            message: `Welcome to ${this.world.name}, ${userId}!`
                        });
                        console.log(`✅ Sent 'worldJoinedConfirmed' to ${userId}.`);

                        // Broadcast 'playerJoined' to *other* players in this world
                        this.broadcast(socket, "playerJoined", {
                            userID: userId,
                            username: data.username || "Player",
                            wizardData: data.wizardData,
                            zone: playerEntry.currentZone
                        });
                        console.log(`Broadcasted 'playerJoined' for ${userId}.`);

                        // Send the current player list to the newly joined player
                        socket.emit("playerList", {
                            players: Array.from(this.connectedPlayers.values()).map(p => ({
                                userID: p.userId,
                                zone: p.currentZone,
                                wizardData: p.wizardData
                            }))
                        });
                        console.log(`Sent initial playerList to ${userId}.`);
                    }
                } else if (data.type === "chatMessage") {
                    this.broadcast(socket, "chatMessage", {
                        userID: userId,
                        message: data.payload.message
                    });
                } else if (data.type === "switchZone") {
                    const playerEntry = this.connectedPlayers.get(userId);
                    if (playerEntry) {
                        playerEntry.currentZone = data.zoneName;
                        this.connectedPlayers.set(userId, playerEntry);
                        console.log(`User ${userId} switched to zone: ${data.zoneName}`);
                        this.broadcast(socket, "playerMoved", {
                            userID: userId,
                            newZone: data.zoneName
                        });
                    }
                }
                // Add more message handling logic as needed for game events
            } catch (e) {
                console.error(`Error parsing message from ${userId} in world ${this.world.id}:`, e);
            }
        });

        // Handle client disconnection
        socket.on("disconnect", (reason) => {
            console.log(`User ${userId} (Socket.ID: ${socket.id}) disconnected from world ${this.world.name}. Reason: ${reason}`);
            this.connectedPlayers.delete(userId); // Remove from connected players map
            this.world.playerCount--; // Decrement player count
            this.broadcast(socket, "playerLeft", { userID: userId }); // Broadcast to others
            console.log(`Current players in ${this.world.name}: ${this.world.playerCount}`);
        });

        socket.on("error", (error) => {
            console.error(`❌ Socket.IO error for user ${userId} in world ${this.world.id}:`, error);
        });
    }

    /**
     * Broadcasts a Socket.IO event to all connected players in this world, excluding the sender.
     * @param {SocketIO.Socket} senderSocket - The socket of the client sending the message (to exclude from broadcast).
     * @param {string} eventName - The name of the event to emit.
     * @param {Object} payload - The data payload for the event.
     */
    broadcast(senderSocket, eventName, payload) {
        this.connectedPlayers.forEach((playerEntry, userId) => {
            if (playerEntry.socket.id !== senderSocket.id) { // Exclude the sender
                playerEntry.socket.emit(eventName, payload);
            }
        });
    }
}

module.exports = WorldSystem;
