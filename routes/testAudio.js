const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { processAudioWithAssembly, streamGoogleTTS } = require('../controllers/assemblyService');

const upload = multer({ dest: 'uploads/' }); // dossier temporaire pour les fichiers

// Endpoint transcription + OpenAI
router.post('/process-audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      console.log('⚠️ Aucun fichier reçu');
      return res.status(400).json({ error: 'Aucun fichier audio reçu' });
    }

    const filePath = path.join(__dirname, '../', req.file.path);
    console.log('📂 Fichier reçu:', req.file);
    console.log('📍 Chemin du fichier:', filePath);

    const result = await processAudioWithAssembly(filePath);

    console.log('✅ Transcription reçue:', result);

    // Supprimer le fichier après traitement
    fs.unlink(filePath, (err) => {
      if (err) console.error('Erreur suppression fichier:', err);
      else console.log('🗑️ Fichier temporaire supprimé');
    });

    res.json(result);
  } catch (err) {
    console.error('❌ Erreur process-audio:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint TTS
router.post('/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Texte manquant' });
    await streamGoogleTTS(text, res);
  } catch (err) {
    console.error('❌ Erreur TTS:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
