const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const assemblyService = require('./controllers/assemblyService');

const clients = new Map(); // Map<deviceId, { ws }>

// WS server
const wss = new WebSocket.Server({ noServer: true });

// Lire les citations
let quotes = []; 
try {
  const raw = fs.readFileSync(path.join(__dirname, 'utils', 'citation'), 'utf8');
  quotes = JSON.parse(raw);
} catch (e) {
  console.warn('[WebSocket] Impossible de charger les citations :', e.message);
  quotes = [];
}

// Ping régulier
setInterval(() => {
  clients.forEach(({ ws }, deviceId) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping('keepalive');
    }
  });
}, 15000);

// Connexion
wss.on('connection', (ws) => {
  let deviceId = null; // ⚠️ Déclaré ici

  ws.on('message', async (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      console.log('[WebSocket] Erreur parsing message :', e.message);
      return;
    }

    // Toujours s'assurer que deviceId est défini
    if (!deviceId && data.deviceId) {
      deviceId = String(data.deviceId);
      ws.deviceId = deviceId;
      clients.set(deviceId, { ws });
      console.log(`[WebSocket] Device connecté : ${deviceId}`);
    }

// Si audio reçu
    if (data.audioBase64) {
      if (!deviceId) {
        console.warn('[WebSocket] Audio reçu mais deviceId manquant, envoi annulé !');
        return;
      }

      try {
        if (!data.audioBase64 || data.audioBase64.length === 0) {
          console.warn('[WebSocket] Audio Base64 vide ou mal formé pour', deviceId);
          return;
        }

        console.log(`[WebSocket] Segment audio reçu de ${deviceId}, taille base64: ${data.audioBase64.length}`);
        await assemblyService.processAudioSegment(data.audioBase64, deviceId); // 🔹 fonction segment
      } catch (err) {
        console.error('[WebSocket] Erreur traitement segment audio pour', deviceId, err.message);
      }
    }

    console.log(`[WebSocket] Message reçu de ${deviceId || 'non identifié'} :`, data);
  });

  // Citation aléatoire toutes les 15s
  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN && deviceId && quotes.length > 0) {
      const randomIndex = Math.floor(Math.random() * quotes.length);
      const payload = { quote: quotes[randomIndex].quote };
      try {
        ws.send(JSON.stringify(payload));
      } catch (e) {
        console.warn('[WebSocket] Envoi citation échoué pour', deviceId, e.message);
      }
    }
  }, 15000);

  ws.on('close', () => {
    clearInterval(interval);
    if (deviceId) {
      clients.delete(deviceId);
      console.log(`[WebSocket] Device déconnecté : ${deviceId}`);
    }
  });

  ws.on('pong', (data) => {
    console.log(`[WebSocket] Pong reçu de device ${deviceId || 'inconnu'} :`, data.toString());
  });
}); // ✅ Fermeture correcte de wss.on('connection')

// Envoie un message UNIQUEMENT au device ciblé.
function sendToFlutter(payload, targetDeviceId) {
  if (!targetDeviceId) {
    console.warn('[WebSocket] Envoi bloqué : deviceId manquant !');
    return false;
  }

  const client = clients.get(String(targetDeviceId));
  if (!client || client.ws.readyState !== WebSocket.OPEN) {
    console.warn('[WebSocket] Device introuvable ou socket fermé :', targetDeviceId);
    return false;
  }

  try {
    client.ws.send(JSON.stringify(payload));
    const shortText = typeof payload.text === 'string' ? payload.text.slice(0, 80) : '';
    console.log(`[WebSocket] -> ${targetDeviceId} | index=${payload.index} | text="${shortText}"`);
    return true;
  } catch (e) {
    console.warn('[WebSocket] Échec envoi à', targetDeviceId, e.message);
    return false;
  }
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
