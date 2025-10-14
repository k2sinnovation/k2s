const express = require('express');
const { google } = require('googleapis');
const router = express.Router();

const BACKEND_URL = process.env.BACKEND_URL;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  `${BACKEND_URL}/api/auth/google/callback`
);

// Démarrer OAuth Google
router.get('/auth/google/start', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ]
  });
  res.redirect(url);
});

// Callback OAuth Google
router.post('/auth/google/callback', async (req, res) => {
  const { code } = req.body;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    res.json({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      email: userInfo.data.email
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Impossible de récupérer le token Google' });
  }
});

module.exports = router;
