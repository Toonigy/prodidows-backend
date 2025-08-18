// World.js
// This file defines the various game worlds and their properties.
const WebSocket = require("ws"); // Ensure WebSocket is imported if this is a standalone file for ws.WebSocket.Server

class World {
    constructor(id, name, path, meta = {}) {
        this.id = id;
        this.name = name;
        this.path = path;
        this.meta = meta; // Additional metadata like element type, etc.
        this.currentPlayers = 0; // Simulate player count for display
        this.maxPlayers = 100; // Max players for this world
        // Store connected sockets for this world to manage player lists and broadcasting
        // Map: socket.id -> { socket, userID, wizardData, currentZone }
        this.connectedSockets = new Map(); 
        console.log(`🚀 World: Initialized "${this.name}" (ID: ${this.id}, Path: ${this.path})`);

        // Create a new raw WebSocket server for this specific world path
        // This 'noServer: true' means it hooks into an existing HTTP/HTTPS server's 'upgrade' event
        this.wss = new WebSocket.Server({ noServer: true });

        // Handle incoming connections for this world
        this.wss.on("connection", (ws, req) => { // 'req' object is now passed from server.js 'upgrade' event
            this.currentPlayers++;
            console.log(`🌐 Player connected to ${this.name}. Current players: ${this.currentPlayers}`);

            const urlParams = new URLSearchParams(req.url.split('?')[1]); // Parse query params from original request URL
            const userID = urlParams.get('userId');
            const userToken = urlParams.get('userToken');
            const initialZone = urlParams.get('zone'); // Get the initial zone from the URL

            // Store connection details (including query params)
            ws.connectionData = { userID, userToken, initialZone };
            this.connectedSockets.set(ws.id, {
                socket: ws,
                userID: userID,
                userToken: userToken,
                currentZone: initialZone // Store the zone for this player
            });

            // Notify all clients in this world about the player count update (simplified)
            this.broadcastWorldsUpdate();

            // Handle messages from the client.
            ws.on("message", (msg) => {
                try {
                    const data = JSON.parse(msg);
                    console.log(`➡️ Received message in ${this.name} world from ${userID}:`, data.type);

                    // ⭐ NEW: Handle the 'joinGameWorld' message from the client ⭐
                    if (data.type === "joinGameWorld" && data.userID && data.zone) {
                        console.log(`✅ User ${data.userID} is joining zone: ${data.zone} in ${this.name}.`);
                        // Update the player's current zone in the map
                        const playerEntry = this.connectedSockets.get(ws.id);
                        if (playerEntry) {
                            playerEntry.currentZone = data.zone;
                        }

                        // ⭐ CRITICAL FIX: Send confirmation back to the client that just joined ⭐
                        ws.send(JSON.stringify({
                            type: "worldJoinedConfirmed",
                            zoneId: data.zone, // Confirm the zone they joined
                            message: "Successfully joined world and zone."
                        }));
                        console.log(`↩️ Sent 'worldJoinedConfirmed' to ${data.userID} for zone ${data.zone}.`);

                        // Broadcast a message to all other clients about the new player.
                        // Filter out the sender so they don't get their own join message broadcast.
                        this.wss.clients.forEach(client => {
                            if (client !== ws && client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({ 
                                    type: "playerJoined", 
                                    userID: data.userID,
                                    username: data.username || "Player", // Include username if available
                                    zone: data.zone // Indicate which zone they joined
                                }));
                            }
                        });
                        console.log(`📢 Broadcasted 'playerJoined' for ${data.userID}.`);

                    } else if (data.type === "chatMessage" && data.message) {
                        // Example: Broadcast chat messages to all clients in this world
                        this.wss.clients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({
                                    type: "chatMessage",
                                    userID: userID, // Or data.userID if sent in message
                                    message: data.message
                                }));
                            }
                        });
                        console.log(`💬 Broadcasted chat from ${userID}: ${data.message}`);
                    }
                    // Add more game-specific message handling logic as needed
                } catch (e) {
                    console.error(`❌ Invalid message received in ${this.name} world from ${userID}:`, e);
                }
            });

            // Handle client disconnection.
            ws.on("close", (code, reason) => {
                this.currentPlayers--;
                const disconnectedUserID = ws.connectionData?.userID || 'Unknown';
                this.connectedSockets.delete(ws.id); // Remove from tracking map
                console.log(`❌ Player ${disconnectedUserID} disconnected from ${this.name}. Current players: ${this.currentPlayers}`);
                this.broadcastWorldsUpdate(); // Update player counts

                // Broadcast player left message to remaining clients
                this.wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: "playerLeft",
                            userID: disconnectedUserID,
                            reason: reason.toString() || "Disconnected"
                        }));
                    }
                });
            });

            // Handle WebSocket errors
            ws.on("error", (error) => {
                console.error(`🔥 WebSocket error for ${userID} in ${this.name} world:`, error);
            });
        });
    }

    // Helper method to send a message to all connected clients in this world.
    broadcast(message) {
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
            }
        });
    }
    
    // Sends a message to all clients with the updated world list.
    // Note: This simplified update is primarily for player counts.
    // A full world list update is typically handled by a central HTTP API.
    broadcastWorldsUpdate() {
        // In a more complex scenario, this would likely trigger an update
        // to a central world list API or a dedicated "world status" channel.
        // For now, it's just a placeholder for updating player counts if needed.
        // This method is called from inside the World instance, so it only affects
        // clients currently connected to *this* specific world.
        // If a lobby needs to show real-time player counts across all worlds,
        // a different mechanism (e.g., periodic polling or a separate Socket.IO connection
        // for lobby updates) would be needed.
    }
}

// Define all your game worlds here.
World.allWorlds = [
    new World("world-fireplane-1", "Fireplane", "/worlds/fireplane", { tag: 'fire', description: 'A volcanic land' }),
    new World("world-icepeak-1", "Icepeak", "/worlds/icepeak", { tag: 'ice', description: 'Frozen mountains' }),
    new World("world-mystic-1", "Mystic Realm", "/worlds/mystic", { tag: 'magic', description: 'Enchanted forests' }),
    new World("world-town-1", "Town Square", "/worlds/town", { tag: 'town', description: 'The bustling central hub' })
    // Add more worlds as your game expands
];

module.exports = World;
