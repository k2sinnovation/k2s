// controllers/assemblyService.js

const fs = require('fs');
const axios = require('axios');
const textToSpeech = require('@google-cloud/text-to-speech');
const { PassThrough } = require('stream');

console.log("ASSEMBLYAI_API_KEY:", process.env.ASSEMBLYAI_API_KEY);

// Initialisation Google TTS
const ttsClient = new textToSpeech.TextToSpeechClient();

// ------------------------
// Transcription AssemblyAI
// ------------------------
async function transcribeWithAssembly(audioPath) {
  try {
    console.log("📥 Lecture du fichier audio :", audioPath);
    const fileData = fs.readFileSync(audioPath);

    // Upload audio
    console.log("⬆️ Upload vers AssemblyAI...");
    const uploadResponse = await axios.post(
      'https://api.assemblyai.com/v2/upload',
      fileData,
      {
        headers: {
          authorization: process.env.ASSEMBLYAI_API_KEY,
          'content-type': 'application/octet-stream',
        },
      }
    );

    const uploadUrl = uploadResponse.data.upload_url;
    console.log("✅ Upload réussi, URL :", uploadUrl);

    // Créer la transcription
    console.log("📝 Création de la transcription...");
    const transcriptResponse = await axios.post(
      'https://api.assemblyai.com/v2/transcript',
      { audio_url: uploadUrl, speech_model: 'universal' },
      { headers: { authorization: process.env.ASSEMBLYAI_API_KEY } }
    );

    const transcriptId = transcriptResponse.data.id;
    console.log("🆔 ID transcription :", transcriptId);

    const pollingEndpoint = `https://api.assemblyai.com/v2/transcript/${transcriptId}`;

    // Polling pour attendre la fin
    while (true) {
      const result = await axios.get(pollingEndpoint, {
        headers: { authorization: process.env.ASSEMBLYAI_API_KEY },
      });

      if (result.data.status === 'completed') {
        console.log("✅ Transcription terminée :", result.data.text);
        return result.data.text;
      } else if (result.data.status === 'error') {
        throw new Error(`Transcription échouée: ${result.data.error}`);
      } else {
        console.log("⏳ Transcription en cours...");
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  } catch (error) {
    console.error("❌ Erreur transcrire avec AssemblyAI :", error.message);
    throw error;
  }
}

// ------------------------
// Streaming TTS Google
// ------------------------
async function streamGoogleTTS(text, res) {
  try {
    console.log("🔊 Génération TTS pour le texte :", text);

    const request = {
      input: { text },
      voice: { languageCode: 'fr-FR', ssmlGender: 'FEMALE' },
      audioConfig: { audioEncoding: 'MP3' },
    };

    const [response] = await ttsClient.synthesizeSpeech(request);
    console.log("✅ TTS généré");

    const stream = new PassThrough();
    stream.end(response.audioContent);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': 'inline; filename="tts.mp3"',
    });

    stream.pipe(res);
  } catch (error) {
    console.error("❌ Erreur Google TTS :", error.message);
    res.status(500).send('Erreur génération TTS');
  }
}

// ------------------------
// Processus central Audio → AssemblyAI
// ------------------------
async function processAudio(filePath) {
  try {
    console.log("▶️ Démarrage du traitement audio :", filePath);
    const texte = await transcribeWithAssembly(filePath);

    // Supprimer le fichier audio temporaire
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log("🗑️ Fichier temporaire supprimé :", filePath);
    }

    return { texte };
  } catch (error) {
    console.error("❌ Erreur processAudio :", error.message);
    throw error;
  }
}

module.exports = { processAudio, streamGoogleTTS, ttsClient };
