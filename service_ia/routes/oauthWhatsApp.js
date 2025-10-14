const express = require('express');
const axios = require('axios');
const router = express.Router();

const BACKEND_URL = process.env.BACKEND_URL;
const CLIENT_ID = process.env.WHATSAPP_CLIENT_ID;
const CLIENT_SECRET = process.env.WHATSAPP_CLIENT_SECRET;

// Démarrer l'OAuth WhatsApp
router.get('/auth/whatsapp/start', (req, res) => {
  const redirectUri = encodeURIComponent(`${BACKEND_URL}/api/auth/whatsapp/callback`);
  const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${CLIENT_ID}&redirect_uri=${redirectUri}&scope=whatsapp_business_management`;
  res.redirect(authUrl);
});

// Callback OAuth WhatsApp
router.post('/auth/whatsapp/callback', async (req, res) => {
  const { code } = req.body;
  try {
    const tokenResponse = await axios.get(`https://graph.facebook.com/v18.0/oauth/access_token`, {
      params: {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: `${BACKEND_URL}/api/auth/whatsapp/callback`,
        code
      }
    });
    const { access_token } = tokenResponse.data;

    // Récupérer le numéro WhatsApp associé
    const phoneResponse = await axios.get(`https://graph.facebook.com/v18.0/me?fields=phone_numbers&access_token=${access_token}`);
    const phoneNumberId = phoneResponse.data.phone_numbers?.[0]?.id || '';

    res.json({
      access_token,
      phone_number_id: phoneNumberId,
      business_account_id: phoneResponse.data.id
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Impossible de récupérer le token WhatsApp' });
  }
});

module.exports = router;
