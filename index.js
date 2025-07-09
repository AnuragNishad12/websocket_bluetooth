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

// Store connected clients with roles
const clients = new Map();
let masterClient = null;

wss.on('connection', (ws) => {
  console.log('🔗 New client connected');

  // Send initial connection message
  ws.send(JSON.stringify({
    type: 'connection',
    message: 'Connected to audio streaming server',
    timestamp: Date.now()
  }));

  ws.on('message', (message) => {
    try {
      // Try to parse as JSON for control messages
      const data = JSON.parse(message);

      if (data.type === 'register') {
        // Register client as master or slave
        clients.set(ws, {
          role: data.role,
          id: data.id,
          connectedAt: Date.now()
        });

        if (data.role === 'master') {
          masterClient = ws;
          console.log(`🎵 Master client registered: ${data.id}`);
        } else {
          console.log(`🎧 Slave client registered: ${data.id}`);
        }

        // Send registration confirmation
        ws.send(JSON.stringify({
          type: 'registered',
          role: data.role,
          connectedClients: clients.size,
          timestamp: Date.now()
        }));

        // Notify all clients about new connection
        broadcastToSlaves({
          type: 'client_update',
          totalClients: clients.size,
          timestamp: Date.now()
        });

      } else if (data.type === 'audio_start') {
        // Master is starting audio stream
        console.log('🎶 Audio stream starting');
        broadcastToSlaves({
          type: 'audio_start',
          timestamp: Date.now()
        });

      } else if (data.type === 'audio_stop') {
        // Master is stopping audio stream
        console.log('⏹️ Audio stream stopping');
        broadcastToSlaves({
          type: 'audio_stop',
          timestamp: Date.now()
        });

      } else if (data.type === 'sync') {
        // Synchronization message
        broadcastToSlaves({
          type: 'sync',
          masterTimestamp: data.timestamp,
          serverTimestamp: Date.now()
        });
      }

    } catch (e) {
      // If not JSON, treat as binary audio data
      if (ws === masterClient) {
        console.log(`🎵 Broadcasting audio chunk of size: ${message.length}`);

        // Add timestamp to audio chunk
        const audioPacket = {
          type: 'audio_chunk',
          timestamp: Date.now(),
          size: message.length
        };

        // Broadcast to all slave clients
        broadcastToSlaves(JSON.stringify(audioPacket));

        // Then send the actual audio data
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            const clientInfo = clients.get(client);
            if (clientInfo && clientInfo.role === 'slave') {
              client.send(message); // Forward the binary audio chunk
            }
          }
        });
      } else {
        console.log('⚠️ Received audio data from non-master client');
      }
    }
  });

  ws.on('close', () => {
    console.log('❌ Client disconnected');

    const clientInfo = clients.get(ws);
    if (clientInfo && clientInfo.role === 'master') {
      masterClient = null;
      console.log('🎵 Master client disconnected');

      // Notify all slaves that master disconnected
      broadcastToSlaves({
        type: 'master_disconnected',
        timestamp: Date.now()
      });
    }

    clients.delete(ws);

    // Notify remaining clients about disconnection
    broadcastToSlaves({
      type: 'client_update',
      totalClients: clients.size,
      timestamp: Date.now()
    });
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Helper function to broadcast to all slave clients
function broadcastToSlaves(message) {
  const messageString = typeof message === 'string' ? message : JSON.stringify(message);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      const clientInfo = clients.get(client);
      if (clientInfo && clientInfo.role === 'slave') {
        client.send(messageString);
      }
    }
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    connectedClients: clients.size,
    masterConnected: masterClient !== null,
    uptime: process.uptime()
  });
});

// Stats endpoint
app.get('/stats', (req, res) => {
  const clientStats = Array.from(clients.entries()).map(([ws, info]) => ({
    role: info.role,
    id: info.id,
    connectedAt: info.connectedAt,
    connected: ws.readyState === WebSocket.OPEN
  }));

  res.json({
    totalClients: clients.size,
    masterConnected: masterClient !== null,
    clients: clientStats,
    uptime: process.uptime()
  });
});

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📈 Stats: http://localhost:${PORT}/stats`);
});