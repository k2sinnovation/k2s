const express = require('express');
const router = express.Router();
const { processAudio, streamGoogleTTS } = require('../controllers/assemblyService');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const upload = multer({ dest: 'uploads/' });

// Route pour uploader et transcrire un audio
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    // Récupérer l'extension du fichier original, sinon '.wav'
    const ext = path.extname(req.file.originalname) || '.wav';

    // Créer un nom unique basé sur horodatage
    const newFilename = `${Date.now()}${ext}`;
    const newPath = path.join('uploads', newFilename);

    // Renommer le fichier
    fs.renameSync(req.file.path, newPath);
    console.log("[UPLOAD] Fichier renommé :", newPath);

    // Envoyer à processAudio
    const result = await processAudio(newPath);
    console.log("[TRANSCRIBE] Transcription obtenue :", result.texte);

    res.json(result);
  } catch (err) {
    console.error("[TRANSCRIBE] Erreur :", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Route pour générer un TTS Google
router.get('/tts', async (req, res) => {
  const { text } = req.query;
  if (!text) return res.status(400).send('Paramètre text manquant');
  
  console.log("[TTS] Texte reçu :", text);
  await streamGoogleTTS(text, res);
});

module.exports = router;
