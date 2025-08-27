const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { processAudioAndReturnJSON } = require('./controllers/assemblyService');


const clients = new Map(); // Map<clientId, { ws }>

// WS server
const wss = new WebSocket.Server({ noServer: true });

// Lire les citations (try/catch pour éviter un crash si le fichier manque)
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
  clients.forEach(({ ws }, clientId) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping('keepalive');
    }
  });
}, 2000);

// Connexion
wss.on('connection', (ws) => {
  let clientId = null;

  ws.on('message', async (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      console.log('[WebSocket] Erreur parsing message :', e.message);
      return;
    }

    // Association clientId obligatoire dès le premier message contenant audio
// ⚡ Association clientId uniquement via Flutter
if (!clientId) {
  if (data.clientId) {
    clientId = String(data.clientId);
    ws.clientId = clientId;
    clients.set(clientId, { ws });
    console.log(`[WebSocket] Client connecté via Flutter : ${clientId}`);
  } else {
    console.warn('[WebSocket] Aucun clientId reçu depuis Flutter pour cette connexion');
  }
}

// ⚡ Traitement audio uniquement si clientId est présent
if (data.audioBase64) {
  if (!clientId) {
    console.warn('[WebSocket] Audio reçu mais clientId Flutter manquant, envoi annulé !');
    return;
  }

  try {
    console.log(`[WebSocket] Audio reçu de Flutter clientId=${clientId}, taille base64: ${data.audioBase64.length}`);
    const result = await processAudioAndReturnJSON(data.audioBase64, clientId, true);
    console.log(`[WebSocket] Audio traité pour clientId=${clientId}, transcription length=${result.transcription?.length || 0}`);
  } catch (err) {
    console.error(`[WebSocket] Erreur traitement audio pour clientId=${clientId}`, err.message);
  }
}


    // Traiter d'autres messages applicatifs si besoin
    console.log(`[WebSocket] Message reçu de ${clientId || 'non identifié'} :`, data);
  });

  // Citation aléatoire toutes les 15s, si dispo
  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN && clientId && quotes.length > 0) {
      const randomIndex = Math.floor(Math.random() * quotes.length);
      const payload = { quote: quotes[randomIndex].quote };
      try {
        ws.send(JSON.stringify(payload));
      } catch (e) {
        console.warn('[WebSocket] Envoi citation échoué pour', clientId, e.message);
      }
    }
  }, 15000);

  ws.on('close', () => {
    clearInterval(interval);
    if (clientId) {
      clients.delete(clientId);
      console.log(`[WebSocket] Client déconnecté : ${clientId}`);
    }
  });

  ws.on('pong', (data) => {
    console.log(`[WebSocket] Pong reçu de client ${clientId || 'inconnu'} :`, data.toString());
  });
});

/**
 * Envoie un message UNIQUEMENT au client ciblé.
 * - targetClientId est OBLIGATOIRE.
 * - payload NE DOIT PAS contenir clientId (routage via paramètre).
 */
function sendToFlutter(payload, targetClientId) {
  if (!targetClientId) {
    console.warn('[WebSocket] Envoi bloqué : clientId manquant !');
    return false;
  }

  const client = clients.get(String(targetClientId));
  if (!client || client.ws.readyState !== WebSocket.OPEN) {
    console.warn('[WebSocket] Client introuvable ou socket fermé :', targetClientId);
    return false;
  }

  try {
    client.ws.send(JSON.stringify(payload));
    const shortText = typeof payload.text === 'string' ? payload.text.slice(0, 80) : '';
    console.log(`[WebSocket] -> ${targetClientId} | index=${payload.index} | text="${shortText}"`);
    return true;
  } catch (e) {
    console.warn('[WebSocket] Échec envoi à', targetClientId, e.message);
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
