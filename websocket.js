const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const clients = new Map(); // clientId -> { ws, canSend }
const fs = require('fs');
const path = require('path');

// Création du serveur WebSocket en mode "noServer" (attaché au HTTP server d'Express)
const wss = new WebSocket.Server({ noServer: true });

// Lire les citations depuis ton fichier JSON
const quotes = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'utils', 'citation'), 'utf8')
);


wss.on('connection', (ws) => {
  // Attribuer un clientId unique pour l'instant
  const clientId = uuidv4();

  // Pour l'instant le quota est toujours true
  const canSend = true;

  // Stocker le ws et le quota
  clients.set(clientId, { ws, canSend });
  ws.clientId = clientId; // pratique pour logs

  console.log(`[WebSocket] Client connecté : ${clientId}, canSend: ${canSend}`);

  ws.on('close', () => {
    clients.delete(clientId);
    console.log(`[WebSocket] Client déconnecté : ${clientId}`);
  });

  ws.on('pong', (data) => {
    console.log(`[WebSocket] Pong reçu de client ${clientId} :`, data.toString());
  });

  ws.on('message', (message) => {
    console.log(`[WebSocket] Message reçu de client ${clientId} :`, message.toString());

    // Exemple futur : vérifier quota avant traitement
    const client = clients.get(clientId);
    if (!client.canSend) {
      console.log(`[WebSocket] Client ${clientId} a atteint son quota, message ignoré.`);
      return;
    }

    // Ici tu pourrais traiter le message (ex : audio) normalement
  });
});

// Ping régulier avec logs
setInterval(() => {
  clients.forEach(({ ws, canSend }, clientId) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping('keepalive');
      console.log(`[WebSocket] Ping envoyé à client ${clientId}, canSend: ${canSend}`);
    }
  });
}, 2000);



// ------------------------
// Fonction pour envoyer des messages à Flutter via WS
// ------------------------
function sendToFlutter(payload) {
  const message = JSON.stringify(payload);
  console.log("[WebSocket] Tentative d’envoi à", clients.size, "client(s) :", payload);

  let sent = false;

  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
      console.log("[WebSocket] Message envoyé au client :", payload.index, payload.text);
      sent = true;
    } else {
      console.log("[WebSocket] Client non ouvert, message ignoré");
    }
  });

  return sent; // retourne true si au moins un client a reçu
}

// ------------------------
// Fonction pour attacher WS à un serveur HTTP
// ------------------------
function attachWebSocketToServer(server) {
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
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

// ------------------------
// Gestion connexion WS
// ------------------------
wss.on('connection', (ws) => {
  console.log("[WebSocket] Client prêt à recevoir des messages");

  // Envoi d’une citation aléatoire toutes les 15 secondes
  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      const randomIndex = Math.floor(Math.random() * quotes.length);
      ws.send(JSON.stringify({ quote: quotes[randomIndex].quote }));
    }
  }, 15000);

  ws.on('close', () => {
    clearInterval(interval);
    clients.delete(ws);
    console.log("[WebSocket] Client déconnecté");
  });

  ws.on('message', (message) => {
    console.log("[WebSocket] Message reçu du client :", message.toString());
  });
});

// ------------------------
// Export
// ------------------------
module.exports = { wss, sendToFlutter, clients, attachWebSocketToServer };
