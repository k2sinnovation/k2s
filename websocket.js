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
    }
  });
}, 2000);

// Connexion
wss.on('connection', (ws) => {
  let clientId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

// Si c'est le premier message avec deviceId
if (data.deviceId && !clientId) {
  clientId = data.deviceId;      // Prendre deviceId comme identifiant client
  ws.clientId = clientId;
  clients.set(clientId, { ws, canSend: true });
  console.log(`[WebSocket] Client connecté : ${clientId}`);
  return; // Ne pas traiter ce message comme un message normal
}


      // Ici tu peux traiter les messages normalement
      console.log(`[WebSocket] Message reçu de client ${clientId || "non identifié"} :`, message.toString());
    } catch (e) {
      console.log(`[WebSocket] Erreur parsing message :`, e);
    }
  });

  // Citation aléatoire toutes les 15s
  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN && clientId) {
      const randomIndex = Math.floor(Math.random() * quotes.length);
      ws.send(JSON.stringify({ quote: quotes[randomIndex].quote }));
    }
  }, 15000);

  ws.on('close', () => {
    clearInterval(interval);
    if (clientId) clients.delete(clientId);
    console.log(`[WebSocket] Client déconnecté : ${clientId}`);
  });

  ws.on('pong', (data) => {
    console.log(`[WebSocket] Pong reçu de client ${clientId} :`, data.toString());
  });
});

// Fonction pour envoyer des messages à Flutter ou autre client
function sendToFlutter(payload, targetClientId = null) {
  const message = JSON.stringify(payload);
  let sent = false;
  clients.forEach(({ ws }, clientId) => {
    if ((targetClientId === null || clientId === targetClientId) && ws.readyState === WebSocket.OPEN) {
      ws.send(message);
      console.log(`[WebSocket] Message envoyé au client ${clientId} :`, payload.index, payload.text);
      sent = true;
    }
  });
  if (!sent) console.warn("[WebSocket] Aucun client trouvé pour l'envoi :", targetClientId);
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
