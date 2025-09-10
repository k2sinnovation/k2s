// openaiWebhookService.js
const express = require('express');
const crypto = require('crypto');
const OpenAI = require('openai');
const { generateGoogleTTSMP3 } = require('./controllers/assemblyService'); // TTS

const router = express.Router();

// =========================
// Récupération des secrets
// =========================
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const webhookSecret = process.env.OPENAI_WEBHOOK_SECRET;

// =========================
// Stockage WebSocket par deviceId (multi-utilisateurs)
// =========================
const { sendToFlutter } = require('./websocket');


// =========================
// Vérification signature HMAC
// =========================
function verifySignature(rawBody, signature) {
  if (!signature) return true; // Tolère l'absence de signature
  const hmac = crypto.createHmac('sha256', webhookSecret);
  hmac.update(rawBody);
  const digest = hmac.digest('base64'); // OpenAI utilise base64 pour webhook

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
// Webhook OpenAI pour tous types d'événements
// =========================
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-openai-signature'];
    const rawBody = req.body.toString();

    console.log('--- Webhook reçu ---');
    console.log('Signature reçue  :', signature);
    console.log('Raw body         :', rawBody);

    // Vérifie HMAC si signature présente
    if (!verifySignature(rawBody, signature)) {
      console.warn('[Webhook] Signature invalide');
      return res.status(403).send('Unauthorized');
    }

    const event = JSON.parse(rawBody);
    console.log('Event type       :', event.type);
    console.log('Event data       :', JSON.stringify(event.data, null, 2));

    // Récupération du deviceId si disponible
    const deviceId = event.data?.metadata?.deviceId || event.metadata?.deviceId;
    if (!deviceId) console.warn('[Webhook] DeviceId absent, traitement TTS impossible');

    // Exemple traitement pour response.completed
if (event.type === 'response.completed' && deviceId) {
  const outputText = event.data?.output_text || '';
  const sentences = outputText
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  console.log(`[Webhook] Nombre de phrases à traiter : ${sentences.length}`);

  await Promise.all(
    sentences.map(async (sentence, i) => {
      try {
        const audioBase64 = await generateGoogleTTSMP3(sentence);
        sendToFlutter(
          { index: i, text: sentence, audioBase64, mime: 'audio/mpeg', deviceId },
          deviceId
        );
      } catch (err) {
        console.error(`[Webhook TTS] Erreur phrase ${i}:`, err.message);
      }
    })
  );
} // <- fermeture du if manquante

res.status(200).send('Webhook reçu');

  } catch (err) {
    console.error('[Webhook] Erreur serveur :', err.message);
    res.status(500).send('Erreur serveur');
  }
});

// =========================
// Fonction pour envoyer une requête GPT avec webhook
// =========================
async function requestGPTDirect(userText, deviceId, promptSystem) {
  try {
    console.log(`[GPT Direct] Envoi requête GPT pour deviceId : ${deviceId}`);

    const completion = await openai.chat.completions.create({
      model: 'gpt-5-chat-latest',
      messages: [
        { role: 'system', content: promptSystem },
        { role: 'user', content: userText },
      ],
    });

    const outputText = completion.choices[0].message.content || '';

    // Découpage en phrases et génération TTS en parallèle
    const sentences = outputText
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(Boolean);

    await Promise.all(
      sentences.map(async (sentence, i) => {
        try {
          const audioBase64 = await generateGoogleTTSMP3(sentence);
          sendToFlutter(
            { index: i, text: sentence, audioBase64, mime: 'audio/mpeg', deviceId },
            deviceId
          );
        } catch (err) {
          console.error(`[GPT Direct TTS] Erreur phrase ${i}:`, err.message);
        }
      })
    );

    return outputText;

  } catch (err) {
    console.error('[GPT Direct] Erreur création completion :', err.message);
    return '';
  }
}


module.exports = {
  router,
  requestGPTWithWebhook,
};
