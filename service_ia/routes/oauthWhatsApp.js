const express = require('express');
const axios = require('axios');
const router = express.Router();

// 🔧 Lecture des variables d'environnement
const BACKEND_URL = process.env.BACKEND_URL || 'https://votre-backend.com';
const CLIENT_ID = process.env.WHATSAPP_CLIENT_ID;
const CLIENT_SECRET = process.env.WHATSAPP_CLIENT_SECRET;

// ==============================
// 🚀 Étape 1 : Démarrage OAuth
// ==============================
router.get('/auth/whatsapp/start', (req, res) => {
  try {
    const redirectUri = encodeURIComponent(`${BACKEND_URL}/api/auth/whatsapp/callback`);
    const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${CLIENT_ID}&redirect_uri=${redirectUri}&scope=whatsapp_business_management`;
    console.log('[OAuth] 🔗 Redirection vers:', authUrl);
    res.redirect(authUrl);
  } catch (err) {
    console.error('[OAuth] ❌ Erreur start:', err);
    res.status(500).json({ error: 'Erreur lors du démarrage OAuth WhatsApp' });
  }
});

// ==========================================
// 🚀 Étape 2 : Callback (échange du code OAuth)
// ==========================================
router.post('/auth/whatsapp/callback', async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Code OAuth manquant' });
  }

  try {
    // 1️⃣ Obtenir le token d'accès
    const tokenResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: `${BACKEND_URL}/api/auth/whatsapp/callback`,
        code,
      },
    });

    const { access_token } = tokenResponse.data;
    console.log('[OAuth] ✅ Access token obtenu.');

    // 2️⃣ Récupérer les infos du compte WhatsApp
    const phoneResponse = await axios.get(
      `https://graph.facebook.com/v18.0/me?fields=phone_numbers,name,id&access_token=${access_token}`
    );

    const phoneNumberId = phoneResponse.data.phone_numbers?.[0]?.id || '';
    const businessAccountId = phoneResponse.data.id;

    console.log('[OAuth] ✅ Compte récupéré :', {
      businessAccountId,
      phoneNumberId,
    });

    // 3️⃣ Retourner les infos au client Flutter
    res.json({
      access_token,
      phone_number_id: phoneNumberId,
      business_account_id: businessAccountId,
    });
  } catch (err) {
    console.error('[OAuth] ❌ Erreur callback :', err.response?.data || err.message);
    res.status(500).json({ error: 'Impossible de récupérer le token WhatsApp' });
  }
});

module.exports = router;
