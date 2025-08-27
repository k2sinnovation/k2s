const WebSocket = require('ws');
// const { v4: uuidv4 } = require('uuid'); // inutile ici, on s'appuie sur deviceId côté client
const fs = require('fs');
const path = require('path');

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

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      console.log('[WebSocket] Erreur parsing message :', e.message);
      return;
    }

    // Premier message: association deviceId -> clientId
    if (data.deviceId && !clientId) {
      clientId = String(data.deviceId);
      ws.clientId = clientId;
      clients.set(clientId, { ws });
      console.log(`[WebSocket] Client connecté : ${clientId}`);
      return;
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
 * - targetClientId est OBLIGATOIRE (plus de broadcast implicite).
 * - payload NE DOIT PAS contenir clientId (routage via paramètre).
 * Retourne true si envoyé, false sinon.
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
    // Logs courts pour éviter de spammer avec de longues chaînes audioBase64
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
