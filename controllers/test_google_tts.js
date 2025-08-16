// controllers/test_google_tts.js
const express = require('express');
const router = express.Router();
const textToSpeech = require('@google-cloud/text-to-speech');

// Crée le client Google TTS
const client = new textToSpeech.TextToSpeechClient();

// Fonction pour générer le TTS en Base64
async function generateGoogleTTSBase64(text) {
  const request = {
    input: { text },
    voice: { languageCode: 'fr-FR', ssmlGender: 'FEMALE' },
    audioConfig: { audioEncoding: 'MP3' },
  };

  const [response] = await client.synthesizeSpeech(request);
  return response.audioContent.toString('base64');
}

// Route GET pour tester
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
