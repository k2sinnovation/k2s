// ws.js
const WebSocket = require('ws');
const clients = new Set();

const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Client connecté au WebSocket');

  ws.on('close', () => clients.delete(ws));
});

function sendToFlutter(segmentAudio, index) {
  const message = JSON.stringify({ index, audioBase64: segmentAudio });
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(message);
  });
}

module.exports = { wss, sendToFlutter, clients };
