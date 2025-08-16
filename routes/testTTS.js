const express = require('express');
const router = express.Router();
const { generateGoogleTTSBase64 } = require('../controllers/test_google_tts'); // <== ton fichier

router.get('/', async (req, res) => {
  try {
    const text = req.query.text || "Bonjour, ceci est un test de synthèse vocale.";
    const audioBase64 = await generateGoogleTTSBase64(text);
    res.json({ success: true, audioBase64 });
  } catch (error) {
    console.error('[Test TTS] Erreur :', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
