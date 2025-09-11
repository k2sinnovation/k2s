const express = require('express');
const router = express.Router();
const { processAudioAndReturnJSONRealtime } = require('../controllers/assemblyService');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const upload = multer({ dest: 'uploads/' });

// Route pour uploader et traiter un audio via GPT-Realtime
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    const deviceId = req.body.deviceId;
    if (!deviceId) return res.status(400).json({ error: 'deviceId manquant' });

    // Renommer le fichier uploadé
    const ext = path.extname(req.file.originalname) || '.wav';
    const newFilename = `${Date.now()}${ext}`;
    const newPath = path.join('uploads', newFilename);
    fs.renameSync(req.file.path, newPath);

    // Appel à GPT-Realtime
    const result = await processAudioAndReturnJSONRealtime(newPath, deviceId);
    res.json(result);

    // Nettoyage
    fs.unlinkSync(newPath);

  } catch (err) {
    console.error("[TRANSCRIBE Realtime] Erreur :", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
