const WebSocket = require('ws');
const clients = new Set();

// Création du serveur WebSocket en mode "noServer" (attaché au HTTP server d'Express)
const wss = new WebSocket.Server({ noServer: true });

// Fonction pour attacher WebSocket au serveur HTTP
function attachWebSocketToServer(server) {
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      // Ajout du client connecté
      clients.add(ws);
      console.log("[WebSocket] Client connecté");

      ws.on('close', () => {
        clients.delete(ws);
        console.log("[WebSocket] Client déconnecté");
      });

      wss.emit('connection', ws, request);
    });
  });
}

// Connexion WS (ici tu peux initialiser les messages entrants si tu veux)
wss.on('connection', (ws) => {
  console.log("[WebSocket] Client prêt à recevoir des messages");

  ws.on('message', (message) => {
    console.log("[WebSocket] Message reçu du client :", message.toString());
  });
});

// Fonction pour envoyer des messages à Flutter
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
