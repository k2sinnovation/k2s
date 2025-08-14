// controllers/assemblyService.js

const fs = require('fs');
const axios = require('axios');
const OpenAI = require("openai");
const textToSpeech = require('@google-cloud/text-to-speech');
const path = require('path');

// Initialisation OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Initialisation Google TTS
const ttsClient = new textToSpeech.TextToSpeechClient();

// Fonction pour transcrire l'audio avec AssemblyAI
async function transcribeWithAssembly(audioPath) {
  try {
    // 1️⃣ Upload fichier
    const audioData = fs.readFileSync(audioPath);
    const uploadResp = await axios.post('https://api.assemblyai.com/v2/upload', audioData, {
      headers: {
        'authorization': process.env.ASSEMBLYAI_API_KEY,
        'transfer-encoding': 'chunked'
      }
    });
    const audioUrl = uploadResp.data.upload_url;

    // 2️⃣ Créer transcription
    const transcribeResp = await axios.post('https://api.assemblyai.com/v2/transcript', {
      audio_url: audioUrl
    }, {
      headers: { 'authorization': process.env.ASSEMBLYAI_API_KEY }
    });
    const transcriptId = transcribeResp.data.id;

    // 3️⃣ Poller jusqu'à ce que la transcription soit terminée
    let transcriptStatus = '';
    let transcriptText = '';
    while (transcriptStatus !== 'completed') {
      const checkResp = await axios.get(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { 'authorization': process.env.ASSEMBLYAI_API_KEY }
      });
      transcriptStatus = checkResp.data.status;
      if (transcriptStatus === 'completed') transcriptText = checkResp.data.text;
      else if (transcriptStatus === 'failed') throw new Error('Transcription échouée');
      else await new Promise(r => setTimeout(r, 1000)); // attendre 1s avant de re-vérifier
    }

    return transcriptText;

  } catch (error) {
    console.error("Erreur AssemblyAI :", error.response?.data || error.message);
    throw new Error('Erreur transcription AssemblyAI');
  }
}

// Fonction pour générer TTS Google Cloud
async function generateGoogleTTS(text) {
  try {
    const request = {
      input: { text },
      voice: { languageCode: 'fr-FR', ssmlGender: 'FEMALE' },
      audioConfig: { audioEncoding: 'MP3' },
    };

    const [response] = await ttsClient.synthesizeSpeech(request);
    return response.audioContent;

  } catch (error) {
    console.error("Erreur Google TTS :", error.message);
    throw new Error('Erreur génération TTS');
  }
}

// Fonction centrale pour traiter l'audio, GPT, et TTS
async function processAudioWithAssembly(filePath) {
  try {
    // 1️⃣ Transcrire
    const texte = await transcribeWithAssembly(filePath);

    // 2️⃣ Envoyer à GPT
    const completion = await openai.chat.completions.create({
      model: "chatgpt-4o-latest",
      messages: [{ role: "user", content: texte }],
    });
    const reponse = completion.choices[0].message.content;

    // 3️⃣ Générer TTS
    const audioBuffer = await generateGoogleTTS(reponse);

    // 4️⃣ Supprimer fichier temporaire
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    return { texte, reponse, audioBuffer };

  } catch (error) {
    console.error("Erreur processAudioWithAssembly :", error);
    throw error;
  }
}

module.exports = { processAudioWithAssembly };

