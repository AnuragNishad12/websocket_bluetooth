const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files (optional client)
app.use(express.static(path.join(__dirname, 'public')));

// Store connected clients with roles
const clients = new Map();
let masterClient = null;

// Optional: Basic rate limiting config (per master stream)
const MIN_AUDIO_INTERVAL = 10; // ms
let lastAudioSentTime = 0;

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
        console.log('🎶 Audio stream starting');
        broadcastToSlaves({
          type: 'audio_start',
          timestamp: Date.now()
        });

      } else if (data.type === 'audio_stop') {
        console.log('⏹️ Audio stream stopping');
        broadcastToSlaves({
          type: 'audio_stop',
          timestamp: Date.now()
        });

      } else if (data.type === 'sync') {
        broadcastToSlaves({
          type: 'sync',
          masterTimestamp: data.timestamp,
          serverTimestamp: Date.now()
        });
      }

    } catch (e) {
      // Handle non-JSON: likely audio binary data
      if (ws === masterClient) {
        const now = Date.now();

        // Optional rate limiting
        if (now - lastAudioSentTime < MIN_AUDIO_INTERVAL) {
          return;
        }
        lastAudioSentTime = now;

        console.log(`🎵 Broadcasting audio chunk of size: ${message.length}`);

        // Metadata
        const audioPacket = {
          type: 'audio_chunk',
          timestamp: now,
          size: message.length
        };

        // Notify slaves about incoming chunk
        broadcastToSlaves(JSON.stringify(audioPacket));

        // Send audio chunk to all slaves with error handling
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            const clientInfo = clients.get(client);
            if (clientInfo && clientInfo.role === 'slave') {
              try {
                client.send(message); // Send binary
              } catch (err) {
                console.error(`❌ Error sending to slave ${clientInfo.id}:`, err);
                client.close();
                clients.delete(client);
              }
            }
          }
        });
      } else {
        console.warn('⚠️ Received audio from non-master client — ignored.');
      }
    }
  });

  ws.on('close', () => {
    console.log('❌ Client disconnected');

    const clientInfo = clients.get(ws);
    if (clientInfo && clientInfo.role === 'master') {
      masterClient = null;
      console.log('🎵 Master client disconnected');

      broadcastToSlaves({
        type: 'master_disconnected',
        timestamp: Date.now()
      });
    }

    clients.delete(ws);

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

// Broadcast helper
function broadcastToSlaves(message) {
  const messageStr = typeof message === 'string' ? message : JSON.stringify(message);

  wss.clients.forEach((client) => {
    const clientInfo = clients.get(client);
    if (client.readyState === WebSocket.OPEN && clientInfo && clientInfo.role === 'slave') {
      try {
        client.send(messageStr);
      } catch (err) {
        console.error(`❌ Error during broadcast to slave ${clientInfo.id}:`, err);
        client.close();
        clients.delete(client);
      }
    }
  });
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    connectedClients: clients.size,
    masterConnected: masterClient !== null,
    uptime: process.uptime()
  });
});

// Client stats
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

// Start the server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📈 Stats: http://localhost:${PORT}/stats`);
});
