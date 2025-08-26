const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const clients = new Map(); // clientId -> { ws, canSend }

// WS server
const wss = new WebSocket.Server({ noServer: true });

// Lire les citations
const quotes = JSON.parse(fs.readFileSync(path.join(__dirname, 'utils', 'citation'), 'utf8'));

// Ping régulier
setInterval(() => {
  clients.forEach(({ ws, canSend }, clientId) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping('keepalive');
      console.log(`[WebSocket] Ping envoyé à client ${clientId}, canSend: ${canSend}`);
    }
  });
}, 2000);

// Connexion
wss.on('connection', (ws) => {
  const clientId = uuidv4();
  const canSend = true;
  ws.clientId = clientId;

  clients.set(clientId, { ws, canSend });
  console.log(`[WebSocket] Client connecté : ${clientId}, canSend: ${canSend}`);

  // Citation aléatoire toutes les 15s
  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      const randomIndex = Math.floor(Math.random() * quotes.length);
      ws.send(JSON.stringify({ quote: quotes[randomIndex].quote }));
    }
  }, 15000);

  ws.on('close', () => {
    clearInterval(interval);
    clients.delete(clientId);
    console.log(`[WebSocket] Client déconnecté : ${clientId}`);
  });

  ws.on('pong', (data) => {
    console.log(`[WebSocket] Pong reçu de client ${clientId} :`, data.toString());
  });

  ws.on('message', (message) => {
    console.log(`[WebSocket] Message reçu de client ${clientId} :`, message.toString());

    const client = clients.get(clientId);
    if (!client.canSend) {
      console.log(`[WebSocket] Client ${clientId} a atteint son quota, message ignoré.`);
      return;
    }

    // Ici tu traites les messages normalement
  });
});

// Fonction pour envoyer des messages à Flutter
function sendToFlutter(payload) {
  const message = JSON.stringify(payload);
  console.log("[WebSocket] Tentative d’envoi à", clients.size, "client(s) :", payload);

  let sent = false;
  clients.forEach(({ ws }, clientId) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
      console.log(`[WebSocket] Message envoyé au client ${clientId} :`, payload.index, payload.text);
      sent = true;
    }
  });
  return sent;
}

// Attacher WS au serveur HTTP
function attachWebSocketToServer(server) {
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
}

module.exports = { wss, sendToFlutter, clients, attachWebSocketToServer };
