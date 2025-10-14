const express = require('express');
const router = express.Router();

// ❌ PAS besoin de cette route pour mobile PKCE
// Le mobile gère tout directement avec Google

// Si tu veux garder une route de test web :
router.get('/auth/google/web-only', (req, res) => {
  res.json({ 
    message: 'OAuth Google pour mobile : gérer dans l\'app Flutter directement avec PKCE' 
  });
});

module.exports = router;
