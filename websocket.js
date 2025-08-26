const WebSocket = require('ws');
const clients = new Set();
const fs = require('fs');
const path = require('path');

// Création du serveur WebSocket en mode "noServer" (attaché au HTTP server d'Express)
const wss = new WebSocket.Server({ noServer: true });

// Lire les citations depuis ton fichier JSON
const quotes = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'utils', 'citation'), 'utf8')
);


// Ping régulier pour garder les connexions WS actives
setInterval(() => {
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping(); // envoie un ping, le client répond automatiquement avec pong
    }
  });
}, 2000); // toutes les 5 secondes


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
