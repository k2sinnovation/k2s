const WebSocket = require('ws');

// Serveur WS sur le même port que ton service HTTP
const wss = new WebSocket.Server({ noServer: true });

// Stocker les clients connectés
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Client WebSocket connecté');

  ws.on('close', () => {
    clients.delete(ws);
    console.log('Client WebSocket déconnecté');
  });
});

// Si tu as un serveur HTTP existant (Express par ex.)
const server = require('./app'); // ton app Express
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Fonction pour envoyer un segment à tous les clients
function sendToFlutter(segmentAudio, index) {
  const message = JSON.stringify({ index, audioBase64: segmentAudio });
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(message);
  });
}

module.exports = { sendToFlutter };
