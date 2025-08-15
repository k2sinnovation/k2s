// controllers/assemblyService.js

const fs = require('fs');
const axios = require('axios');
const OpenAI = require("openai");
const textToSpeech = require('@google-cloud/text-to-speech');
const { PassThrough } = require('stream');
const path = require('path');

// Initialisation OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Initialisation Google TTS
const ttsClient = new textToSpeech.TextToSpeechClient();

// ------------------------
// Transcription AssemblyAI
// ------------------------
async function transcribeWithAssembly(audioPath) {
  try {
    const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
    const fileData = fs.readFileSync(audioPath);

    // Upload
    const uploadResponse = await axios.post(
      'https://api.assemblyai.com/v2/upload',
      fileData,
      {
        headers: {
          authorization: ASSEMBLYAI_API_KEY,
          'content-type': 'application/octet-stream',
        },
      }
    );

    const uploadUrl = uploadResponse.data.upload_url;

    // Créer transcription
    const transcriptResponse = await axios.post(
      'https://api.assemblyai.com/v2/transcript',
      { audio_url: uploadUrl },
      { headers: { authorization: ASSEMBLYAI_API_KEY } }
    );

    const transcriptId = transcriptResponse.data.id;

    // Polling
    while (true) {
      const result = await axios.get(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        { headers: { authorization: ASSEMBLYAI_API_KEY } }
      );

      if (result.data.status === 'completed') return result.data.text;
      if (result.data.status === 'failed') throw new Error('Transcription échouée');

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

  } catch (error) {
    console.error("Erreur transcrire avec AssemblyAI :", error.message);
    throw error;
  }
}

// ------------------------
// Streaming TTS Google
// ------------------------
async function streamGoogleTTS(text, res) {
  try {
    const request = {
      input: { text },
      voice: { languageCode: 'fr-FR', ssmlGender: 'FEMALE' },
      audioConfig: { audioEncoding: 'MP3' },
    };

    const [response] = await ttsClient.synthesizeSpeech(request);

    const stream = new PassThrough();
    stream.end(response.audioContent);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': 'inline; filename="tts.mp3"',
    });

    stream.pipe(res);

  } catch (error) {
    console.error("Erreur Google TTS :", error.message);
    res.status(500).send('Erreur génération TTS');
  }
}

// ------------------------
// Processus central Audio → AssemblyAI → OpenAI
// ------------------------
async function processAudioWithAssembly(filePath) {
  try {
    const texte = await transcribeWithAssembly(filePath);

    const completion = await openai.chat.completions.create({
      model: "chatgpt-4o-latest",
      messages: [{ role: "user", content: texte }],
    });

    const reponse = completion.choices[0].message.content;

    // Supprimer le fichier audio temporaire
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    return { texte, reponse };

  } catch (error) {
    console.error("Erreur processAudioWithAssembly :", error.message);
    throw error;
  }
}

module.exports = { processAudioWithAssembly, streamGoogleTTS };
