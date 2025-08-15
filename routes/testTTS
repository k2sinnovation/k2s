// routes/testTTS.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { ttsClient } = require('../controllers/assemblyService'); // on adapte un peu

// Génération TTS et sauvegarde en fichier
router.post('/test-tts-file', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Le champ "text" est requis.' });

    const request = {
      input: { text },
      voice: { languageCode: 'fr-FR', ssmlGender: 'FEMALE' },
      audioConfig: { audioEncoding: 'MP3' },
    };

    const [response] = await ttsClient.synthesizeSpeech(request);

    // Nom du fichier unique
    const fileName = `tts_${Date.now()}.mp3`;
    const filePath = path.join(__dirname, '..', 'uploads', fileName);

    // Écriture du fichier
    fs.writeFileSync(filePath, response.audioContent, 'binary');

    // Renvoie le chemin ou le nom du fichier
    res.json({ file: `/uploads/${fileName}` });

  } catch (error) {
    console.error("Erreur /test-tts-file :", error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
