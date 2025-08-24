const WebSocket = require('ws');
const clients = new Set();

const wss = new WebSocket.Server({ noServer: true });

// Nouvelle partie : gérer l'upgrade HTTP -> WS
function attachWebSocketToServer(server) {
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
}

// Connexion WS
wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Client connecté au WebSocket');

  ws.on('close', () => {
    clients.delete(ws);
    console.log('Client déconnecté du WebSocket');
  });
});

function sendToFlutter(payload) {
  const message = JSON.stringify(payload);
  console.log("[WebSocket] Tentative d’envoi à", clients.size, "client(s) :", payload);

  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
      console.log("[WebSocket] Message envoyé au client :", payload.index, payload.text);
    } else {
      console.log("[WebSocket] Client non ouvert, message ignoré");
    }
  });
}

module.exports = { wss, sendToFlutter, clients, attachWebSocketToServer };
