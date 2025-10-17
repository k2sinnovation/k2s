const express = require('express');
const router = express.Router();
const axios = require('axios');

// Configuration WhatsApp
const WHATSAPP_API_VERSION = 'v18.0';
const WHATSAPP_BASE_URL = `https://graph.facebook.com/${WHATSAPP_API_VERSION}`;

// ===== MIDDLEWARE D'AUTHENTIFICATION =====

const authMiddleware = (req, res, next) => {
  const token = req.headers['x-whatsapp-token'];
  if (!token) {
    return res.status(401).json({ error: 'Token WhatsApp manquant' });
  }
  req.whatsappToken = token;
  next();
};

// ========================================
// WHATSAPP API ROUTES
// ========================================

// GET /api/whatsapp/messages - Récupérer les messages WhatsApp
router.get('/messages', authMiddleware, async (req, res) => {
  try {
    const { phoneNumberId, cursor } = req.query;
    
    if (!phoneNumberId) {
      return res.status(400).json({ error: 'phoneNumberId requis' });
    }

    console.log('📥 [WhatsApp] Récupération messages...');

    const url = `${WHATSAPP_BASE_URL}/${phoneNumberId}/messages`;
    
    const params = { limit: 20 };
    if (cursor) params.after = cursor;

    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${req.whatsappToken}` },
      params,
    });

    const messages = response.data.data.map(msg => ({
      id: msg.id,
      from: msg.from,
      timestamp: new Date(parseInt(msg.timestamp) * 1000),
      type: msg.type,
      text: msg.text?.body || '',
      isRead: msg.status === 'read',
    }));

    console.log(`✅ [WhatsApp] ${messages.length} messages récupérés`);

    res.json({
      messages,
      nextCursor: response.data.paging?.cursors?.after,
    });

  } catch (error) {
    console.error('❌ [WhatsApp] Erreur messages:', error.message);
    res.status(error.response?.status || 500).json({
      error: 'Erreur récupération messages',
      details: error.response?.data || error.message,
    });
  }
});

// POST /api/whatsapp/send - Envoyer un message WhatsApp
router.post('/send', authMiddleware, async (req, res) => {
  try {
    const { phoneNumberId, to, message } = req.body;

    if (!phoneNumberId || !to || !message) {
      return res.status(400).json({ 
        error: 'phoneNumberId, to et message requis' 
      });
    }

    console.log(`📤 [WhatsApp] Envoi message à ${to}...`);

    const url = `${WHATSAPP_BASE_URL}/${phoneNumberId}/messages`;

    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${req.whatsappToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log(`✅ [WhatsApp] Message envoyé: ${response.data.messages[0].id}`);

    res.json({
      success: true,
      messageId: response.data.messages[0].id,
    });

  } catch (error) {
    console.error('❌ [WhatsApp] Erreur envoi:', error.message);
    res.status(error.response?.status || 500).json({
      error: 'Erreur envoi message',
      details: error.response?.data || error.message,
    });
  }
});

// POST /api/whatsapp/webhook - Recevoir les webhooks WhatsApp (notifications temps réel)
router.post('/webhook', async (req, res) => {
  try {
    const { entry } = req.body;

    if (!entry || !entry[0]?.changes) {
      return res.sendStatus(200);
    }

    console.log('📨 [WhatsApp] Webhook reçu');

    // Traiter chaque changement
    for (const change of entry[0].changes) {
      if (change.field === 'messages') {
        const messages = change.value.messages;
        
        if (messages) {
          for (const message of messages) {
            console.log(`📱 [WhatsApp] Nouveau message: ${message.id}`);

            // Récupérer le WebSocket depuis l'app
            const wss = req.app.get('wss');
            const clients = req.app.get('wsClients');

            if (wss && clients) {
              // Émettre à tous les clients connectés (ou filtrer par deviceId si nécessaire)
              clients.forEach((client, deviceId) => {
                if (client.ws.readyState === 1) { // OPEN
                  client.ws.send(JSON.stringify({
                    type: 'new_whatsapp_message',
                    id: message.id,
                    from: message.from,
                    timestamp: new Date(parseInt(message.timestamp) * 1000),
                    messageType: message.type,
                    text: message.text?.body || '',
                  }));
                  console.log(`📤 [WhatsApp] Message envoyé au device ${deviceId}`);
                }
              });
            }
          }
        }
      }
    }

    res.sendStatus(200);

  } catch (error) {
    console.error('❌ [WhatsApp] Erreur webhook:', error.message);
    res.sendStatus(500);
  }
});

// GET /api/whatsapp/webhook - Vérification webhook (requis par Meta)
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Token de vérification à définir dans vos variables d'environnement
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'votre_token_verification';

  console.log('🔍 [WhatsApp] Vérification webhook...');
  console.log('  - Mode:', mode);
  console.log('  - Token:', token);

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ [WhatsApp] Webhook vérifié');
    res.status(200).send(challenge);
  } else {
    console.log('❌ [WhatsApp] Échec vérification webhook');
    res.sendStatus(403);
  }
});

module.exports = router;
