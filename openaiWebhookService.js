// openaiWebhookService.js
const express = require('express');
const crypto = require('crypto');
const OpenAI = require('openai');
const { generateGoogleTTSMP3 } = require('./controllers/assemblyService'); // TTS
const WebSocket = require('ws');

const router = express.Router();

// =========================
// Récupération des secrets
// =========================
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const webhookSecret = process.env.OPENAI_WEBHOOK_SECRET;

// =========================
// Stockage WebSocket par deviceId (multi-utilisateurs)
// =========================
const clients = {}; // deviceId => websocket
const wss = new WebSocket.Server({ noServer: true });

function registerClient(deviceId, ws) {
  clients[deviceId] = ws;
  console.log(`[WebSocket] Client enregistré : ${deviceId}`);
}

function sendToFlutter(payload, deviceId) {
  const ws = clients[deviceId];
  if (!ws || ws.readyState !== ws.OPEN) {
    console.warn(`[WebSocket] Pas de client actif pour ${deviceId}`);
    return;
  }
  ws.send(JSON.stringify(payload));
}

function handleWebSocket(server) {
  server.on('upgrade', (request, socket, head) => {
    const urlParams = new URLSearchParams(request.url.replace('/?', ''));
    const deviceId = urlParams.get('deviceId');
    if (!deviceId) {
      console.warn('[WebSocket] deviceId manquant dans la requête upgrade');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      registerClient(deviceId, ws);
      ws.on('close', () => {
        delete clients[deviceId];
        console.log(`[WebSocket] Client déconnecté : ${deviceId}`);
      });
    });
  });
}

// =========================
// Vérification signature HMAC
// =========================
function verifySignature(rawBody, signature) {
  const hmac = crypto.createHmac('sha256', webhookSecret);
  hmac.update(rawBody);
  const digest = hmac.digest('base64'); // ⚠️ OpenAI utilise base64 pour webhook

  console.log('--- Vérification Webhook ---');
  console.log('Signature reçue  :', signature);
  console.log('Digest attendu   :', digest);

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'base64'),
      Buffer.from(digest, 'base64')
    );
  } catch (e) {
    console.error('Erreur comparaison HMAC:', e.message);
    return false;
  }
}

// =========================
// Webhook OpenAI pour completions
// =========================
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-openai-signature'];
    const rawBody = req.body.toString(); // Corps brut en string

    console.log('--- Webhook reçu ---');
    console.log('Signature reçue  :', signature);
    console.log('Raw body         :', rawBody);

    if (!signature || !verifySignature(rawBody, signature)) {
      console.warn('[Webhook] Signature invalide');
      return res.status(403).send('Unauthorized');
    }

    const event = JSON.parse(rawBody);
    const deviceId = event.metadata?.deviceId;
    if (!deviceId) {
      console.warn('[Webhook] DeviceId manquant dans metadata');
      return res.status(400).send('DeviceId manquant');
    }

    console.log(`[Webhook] Event type : ${event.event_type}, deviceId : ${deviceId}`);

    if (event.event_type === 'completion.completed') {
      const sentences = event.completion.output_text
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(Boolean);

      console.log(`[Webhook] Nombre de phrases à traiter : ${sentences.length}`);

      await Promise.all(
        sentences.map(async (sentence, i) => {
          try {
            const audioBase64 = await generateGoogleTTSMP3(sentence);
            console.log(`[Webhook] Phrase ${i} traitée :`, sentence);
            sendToFlutter(
              { index: i, text: sentence, audioBase64, mime: 'audio/mpeg', deviceId },
              deviceId
            );
          } catch (err) {
            console.error(`[Webhook TTS] Erreur phrase ${i}:`, err.message);
          }
        })
      );
    }

    res.status(200).send('Webhook reçu');
  } catch (err) {
    console.error('[Webhook] Erreur serveur :', err.message);
    res.status(500).send('Erreur serveur');
  }
});

// =========================
// Fonction pour envoyer une requête GPT avec webhook
// =========================
async function requestGPTWithWebhook(userText, deviceId, promptSystem) {
  try {
    console.log(`[GPT Webhook] Envoi requête GPT pour deviceId : ${deviceId}`);
    await openai.chat.completions.create({
      model: 'gpt-5-chat-latest',
      messages: [
        { role: 'system', content: promptSystem },
        { role: 'user', content: userText },
      ],
      webhook: 'https://k2s.onrender.com/openai-webhook',
      webhook_secret: webhookSecret,
      metadata: { deviceId },
    });
  } catch (err) {
    console.error('[GPT Webhook] Erreur création completion :', err.message);
  }
}

module.exports = {
  router,
  handleWebSocket,
  requestGPTWithWebhook,
  sendToFlutter,
};
