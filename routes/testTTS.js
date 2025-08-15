// routes/testTTS.js
const express = require('express');
const router = express.Router();
const { streamGoogleTTS } = require('../controllers/assemblyService');

// Génération TTS et streaming direct
router.post('/test-tts-stream', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Le champ "text" est requis.' });

    // streamGoogleTTS s'occupe de générer le MP3 et de l'envoyer
    await streamGoogleTTS(text, res);

  } catch (error) {
    console.error("Erreur /test-tts-stream :", error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
