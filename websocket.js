// ws.js
const WebSocket = require('ws');
const clients = new Set();

const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Client connecté au WebSocket');

  ws.on('close', () => clients.delete(ws));
});

function sendToFlutter(payload) {
  // payload = { index, text, audioBase64, mime }
  const message = JSON.stringify(payload);
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(message);
  });
}

module.exports = { wss, sendToFlutter, clients };

