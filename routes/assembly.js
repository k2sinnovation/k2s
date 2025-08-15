const express = require('express');
const router = express.Router();
const { processAudio, streamGoogleTTS } = require('../controllers/assemblyService');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

// Route pour uploader et transcrire un audio
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    const result = await processAudio(req.file.path);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Route pour générer un TTS Google
router.get('/tts', async (req, res) => {
  const { text } = req.query;
  if (!text) return res.status(400).send('Paramètre text manquant');
  await streamGoogleTTS(text, res);
});

module.exports = router;
