// World.js
// This file defines the various game worlds and their properties.
const WebSocket = require("ws"); // ⭐ NEW: Import the ws library ⭐

class World {
    constructor(id, name, path, meta = {}) {
        this.id = id;
        this.name = name;
        this.path = path;
        this.meta = meta; // Additional metadata like element type, etc.
        this.currentPlayers = 0; // Track actual connected players for this world
        this.maxPlayers = 100; // Max players for this world

        // ⭐ NEW: Initialize a raw WebSocket.Server instance for this world ⭐
        // 'noServer: true' means it won't listen on its own port, but will be handled
        // by the main HTTP/HTTPS server's 'upgrade' event (in server.js).
        this.wss = new WebSocket.Server({ noServer: true });
        this.connectedClients = new Map(); // Map: ws -> { userID, wizardData, currentZone }

        console.log(`🚀 World: Initialized "${this.name}" (ID: ${this.id}, Path: ${this.path}) with WSS instance.`);

        // --- Raw WebSocket Event Handlers for THIS WORLD ---
        // These handlers are specific to the WebSocket connections managed by this World's wss instance.
        this.wss.on("connection", (ws, req) => {
            // Parse query parameters from the upgrade request URL
            const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
            const userId = parsedUrl.searchParams.get('userId');
            const userToken = parsedUrl.searchParams.get('userToken');
            const zone = parsedUrl.searchParams.get('zone') || 'unknown';
            const worldIdFromClient = parsedUrl.searchParams.get('worldId');
            const worldNameFromClient = decodeURIComponent(parsedUrl.searchParams.get('worldName') || 'Unknown World');

            if (!userId || !worldIdFromClient) {
                console.error(`World "${this.name}": Missing userId or worldId in WebSocket handshake. Closing connection.`);
                ws.close(1008, "Missing userId or worldId"); // Close with specific code
                return;
            }

            if (this.currentPlayers >= this.maxPlayers) {
                console.warn(`World "${this.name}" is full. Rejecting user ${userId}.`);
                ws.send(JSON.stringify({ type: "worldFull", message: "World is full." }));
                ws.close(1013, "World full"); // Service Unavailable
                return;
            }
            
            this.currentPlayers++;
            this.connectedClients.set(ws, { userId, userToken, currentZone: zone, wizardData: null });
            console.log(`🌐 Raw WS: User ${userId} connected to "${this.name}". Current players: ${this.currentPlayers}`);

            // Send initial confirmation to the client
            ws.send(JSON.stringify({
                type: "worldJoinedConfirmed",
                worldId: this.id,
                zoneId: zone,
                worldName: this.name,
                message: `Welcome to ${this.name}, ${userId}!`
            }));
            console.log(`✅ Raw WS: Sent 'worldJoinedConfirmed' to ${userId}.`);

            // ⭐ Handle incoming 'message' events from this specific raw WebSocket client ⭐
            ws.on("message", message => {
                try {
                    const data = JSON.parse(message); // Raw WS messages are usually strings and need parsing
                    console.log(`➡️ Raw WS Message from ${userId} in "${this.name}":`, data.type);

                    if (data.type === "joinMultiplayerServer") {
                        // This message is sent by the client after initial connection to fully 'join'
                        const clientData = this.connectedClients.get(ws);
                        if (clientData) {
                            clientData.wizardData = data.wizardData;
                            clientData.currentZone = data.zone;
                            this.connectedClients.set(ws, clientData); // Update stored data

                            // Broadcast 'playerJoined' to *other* players in this world
                            this.broadcast(ws, "playerJoined", {
                                userID: userId,
                                username: clientData.wizardData?.appearance?.name || "Player", // Use wizardData for username
                                wizardData: clientData.wizardData,
                                zone: clientData.currentZone,
                                worldId: this.id,
                                worldName: this.name
                            });
                            console.log(`📢 Raw WS: Broadcasted 'playerJoined' for ${userId}.`);

                            // Send the current player list to the newly joined player
                            ws.send(JSON.stringify({
                                type: "playerList",
                                players: Array.from(this.connectedClients.values()).map(p => ({
                                    userID: p.userId,
                                    zone: p.currentZone,
                                    worldId: this.id,
                                    worldName: this.name,
                                    wizardData: p.wizardData
                                }))
                            }));
                            console.log(`Raw WS: Sent initial playerList to ${userId}.`);
                        }
                    } else if (data.type === "chatMessage") {
                        this.broadcast(ws, "chatMessage", { userID: userId, message: data.message });
                    } else if (data.type === "switchZone") {
                        const clientData = this.connectedClients.get(ws);
                        if (clientData) {
                            clientData.currentZone = data.zoneName;
                            this.connectedClients.set(ws, clientData);
                            console.log(`User ${userId} switched to zone: ${data.zoneName} in world "${this.name}".`);
                            this.broadcast(ws, "playerMoved", {
                                userID: userId,
                                newZone: data.zoneName,
                                worldId: this.id,
                                worldName: this.name
                            });
                        }
                    }
                    // Add more game-specific message handling logic as needed
                } catch (e) {
                    console.error(`❌ Raw WS: Error parsing message from ${userId} in "${this.name}":`, e);
                }
            });

            ws.on("close", (code, reason) => {
                this.currentPlayers--;
                this.connectedClients.delete(ws);
                console.log(`❌ Raw WS: User ${userId} disconnected from "${this.name}". Code: ${code}, Reason: ${reason}. Current players: ${this.currentPlayers}`);
                this.broadcast(null, "playerLeft", { userID: userId, worldId: this.id, worldName: this.name, reason: reason.toString() });
            });

            ws.on("error", error => {
                console.error(`🔥 Raw WS: Error for user ${userId} in "${this.name}":`, error);
            });
        });
    }

    /**
     * Sends a message to all connected clients in this world, optionally excluding a sender.
     * This method uses the raw WebSocket 'send' method.
     * @param {WebSocket|null} senderWs - The WebSocket of the client sending the message (to exclude from broadcast), or null to send to all.
     * @param {string} eventType - The type of event to send (e.g., "playerJoined", "chatMessage").
     * @param {Object} payload - The data payload for the event.
     */
    broadcast(senderWs, eventType, payload) {
        const message = JSON.stringify({ type: eventType, ...payload });
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                if (senderWs === null || client !== senderWs) { // Send to all or exclude sender
                    client.send(message);
                }
            }
        });
    }

    /**
     * Returns a simplified object representation of the world,
     * suitable for sending to the client in the world list.
     * The client typically expects 'id', 'name', 'path', and 'full' (player count status).
     */
    toSimplifiedObject() {
        // Calculate a simulated 'fullness' percentage for demonstration
        const fullness = Math.floor((this.currentPlayers / this.maxPlayers) * 100);

        // Create a shallow copy of the original meta object
        const cleanedMeta = { ...this.meta };
        delete cleanedMeta.description; // Remove description as per request

        return {
            id: this.id,
            name: this.name,
            path: this.path,
            full: fullness, // Percentage of fullness (0-100)
            meta: cleanedMeta // Cleaned meta object
        };
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
