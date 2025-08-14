// controllers/assemblyService.js

const fs = require('fs');
const axios = require('axios');
const OpenAI = require("openai");
const textToSpeech = require('@google-cloud/text-to-speech');
const path = require('path');
const { PassThrough } = require('stream');

// Initialisation OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Initialisation Google TTS
const ttsClient = new textToSpeech.TextToSpeechClient();

// Transcription AssemblyAI (identique)
async function transcribeWithAssembly(audioPath) {
  // ... (même code que précédemment)
}

// Fonction pour générer TTS en streaming
async function streamGoogleTTS(text, res) {
  try {
    const request = {
      input: { text },
      voice: { languageCode: 'fr-FR', ssmlGender: 'FEMALE' },
      audioConfig: { audioEncoding: 'MP3' },
    };

    // synthèse TTS
    const [response] = await ttsClient.synthesizeSpeech(request);

    // créer un flux depuis le buffer
    const stream = new PassThrough();
    stream.end(response.audioContent);

    // définir headers pour le streaming MP3
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': 'inline; filename="tts.mp3"',
    });

    // pipe vers le client
    stream.pipe(res);

  } catch (error) {
    console.error("Erreur Google TTS :", error.message);
    res.status(500).send('Erreur génération TTS');
  }
}

// Fonction centrale pour transcription + GPT
async function processAudioWithAssembly(filePath) {
  try {
    const texte = await transcribeWithAssembly(filePath);

    const completion = await openai.chat.completions.create({
      model: "chatgpt-4o-latest",
      messages: [{ role: "user", content: texte }],
    });
    const reponse = completion.choices[0].message.content;

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    return { texte, reponse };

  } catch (error) {
    console.error("Erreur processAudioWithAssembly :", error);
    throw error;
  }
}

module.exports = { processAudioWithAssembly, streamGoogleTTS };
