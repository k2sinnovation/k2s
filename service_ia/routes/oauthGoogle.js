const express = require('express');
const router = express.Router();

const BACKEND_URL = process.env.BACKEND_URL;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID; // juste l'ID client Android/iOS

router.get('/auth/google/start', (req, res) => {
  const redirectUri = `${BACKEND_URL}/api/auth/google/callback`;
  const scope = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ].join(' ');

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}` +
    `&access_type=offline` +
    `&prompt=consent`;

  res.redirect(authUrl);
});

module.exports = router;
