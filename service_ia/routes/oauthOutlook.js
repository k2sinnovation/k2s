const express = require('express');
const axios = require('axios');
const router = express.Router();

const BACKEND_URL = process.env.BACKEND_URL;
const CLIENT_ID = process.env.OUTLOOK_CLIENT_ID;
const CLIENT_SECRET = process.env.OUTLOOK_CLIENT_SECRET;

// Démarrer OAuth Outlook
router.get('/auth/outlook/start', (req, res) => {
  const redirectUri = encodeURIComponent(`${BACKEND_URL}/api/auth/outlook/callback`);
  const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${redirectUri}&response_mode=query&scope=offline_access%20Mail.Send%20User.Read`;
  res.redirect(authUrl);
});

// Callback OAuth Outlook
router.post('/auth/outlook/callback', async (req, res) => {
  const { code } = req.body;
  try {
    const params = new URLSearchParams();
    params.append('client_id', CLIENT_ID);
    params.append('client_secret', CLIENT_SECRET);
    params.append('code', code);
    params.append('grant_type', 'authorization_code');
    params.append('redirect_uri', `${BACKEND_URL}/api/auth/outlook/callback`);

    const tokenResponse = await axios.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', params);
    const accessToken = tokenResponse.data.access_token;

    const me = await axios.get('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    res.json({
      access_token: accessToken,
      refresh_token: tokenResponse.data.refresh_token,
      email: me.data.userPrincipalName
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Impossible de récupérer le token Outlook' });
  }
});

module.exports = router;
