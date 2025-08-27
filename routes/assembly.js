const express = require('express');
const router = express.Router();
const { processAudioAndReturnJSON, generateGoogleTTSBase64 } = require('../controllers/assemblyService');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const upload = multer({ dest: 'uploads/' });

// Route pour uploader et transcrire un audio
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    const ext = path.extname(req.file.originalname) || '.wav';
    const newFilename = `${Date.now()}${ext}`;
    const newPath = path.join('uploads', newFilename);

    fs.renameSync(req.file.path, newPath);
    console.log("[UPLOAD] Fichier renommé :", newPath);

    const result = await processAudioAndReturnJSON(newPath);
    console.log("[TRANSCRIBE] Transcription obtenue :", result.transcription);

    res.json(result);

  } catch (err) {
    console.error("[TRANSCRIBE] Erreur :", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Route pour générer un TTS Google (optionnel)
router.get('/tts', async (req, res) => {
  const { text } = req.query;
  if (!text) return res.status(400).send('Paramètre text manquant');

  try {
    console.log("[TTS] Texte reçu :", text);
    const audioBase64 = await generateGoogleTTSBase64(text);
    res.json({ audioBase64 });
  } catch (err) {
    console.error("[TTS] Erreur :", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
