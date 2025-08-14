const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { processAudioWithAssembly, streamGoogleTTS } = require('../controllers/assemblyService');

const upload = multer({ dest: 'uploads/' }); // dossier temporaire pour les fichiers

// Endpoint transcription + OpenAI
router.post('/process-audio', upload.single('audio'), async (req, res) => {
  try {
    const filePath = path.join(__dirname, '../', req.file.path);
    const result = await processAudioWithAssembly(filePath);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint TTS
router.post('/tts', async (req, res) => {
  try {
    const { text } = req.body;
    await streamGoogleTTS(text, res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
