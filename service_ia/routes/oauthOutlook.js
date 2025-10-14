const express = require('express');
const router = express.Router();

// ✅ Cette route n'est PLUS utilisée par le mobile
// Le mobile fait l'OAuth directement avec Microsoft via PKCE

// Route info seulement (optionnel)
router.get('/auth/outlook/info', (req, res) => {
  res.json({ 
    message: 'OAuth Outlook pour mobile Android/iOS : utiliser PKCE dans Flutter',
    doc: 'https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow'
  });
});

module.exports = router;
