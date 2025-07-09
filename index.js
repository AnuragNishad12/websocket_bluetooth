const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Create WebSocket server on top of HTTP server
const wss = new WebSocket.Server({ server });

// Serve static files (optional client)
app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws) => {
  console.log('🔗 New client connected');

  ws.on('message', (message) => {
    console.log(`📦 Received message of size: ${message.length}`);

    // Broadcast to all other connected clients
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message); // Forward the binary MP3 chunk
      }
    });
  });

  ws.on('close', () => {
    console.log('❌ Client disconnected');
  });
});

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});