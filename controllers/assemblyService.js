// controllers/assemblyService.js

const fs = require('fs');
const axios = require('axios');
const textToSpeech = require('@google-cloud/text-to-speech');
const { PassThrough } = require('stream');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

console.log("ASSEMBLYAI_API_KEY:", process.env.ASSEMBLYAI_API_KEY);

// Initialisation Google TTS
const ttsClient = new textToSpeech.TextToSpeechClient();

// ------------------------
// Transcription AssemblyAI
// ------------------------
async function transcribeWithAssembly(audioPath) {
  try {
    console.log(`[AssemblyAI] Lecture du fichier audio : ${audioPath}`);
    const fileData = fs.readFileSync(audioPath);

    console.log("[AssemblyAI] Upload audio en cours...");
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
    console.log(`[AssemblyAI] Audio uploadé : ${uploadUrl}`);

    // Créer la transcription
    console.log("[AssemblyAI] Création de la transcription...");
    const transcriptResponse = await axios.post(
      'https://api.assemblyai.com/v2/transcript',
      { audio_url: uploadUrl, speech_model: 'universal', language_code: 'fr' },
      { headers: { authorization: process.env.ASSEMBLYAI_API_KEY } }
    );

    const transcriptId = transcriptResponse.data.id;
    console.log(`[AssemblyAI] ID transcription : ${transcriptId}`);
    const pollingEndpoint = `https://api.assemblyai.com/v2/transcript/${transcriptId}`;

    // Polling pour attendre la fin
    while (true) {
      const result = await axios.get(pollingEndpoint, {
        headers: { authorization: process.env.ASSEMBLYAI_API_KEY },
      });

      if (result.data.status === 'completed') {
        console.log(`[AssemblyAI] Transcription terminée : ${result.data.text}`);
        return result.data.text;
      } else if (result.data.status === 'error') {
        throw new Error(`Transcription échouée: ${result.data.error}`);
      } else {
        console.log("[AssemblyAI] Transcription en cours...");
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  } catch (error) {
    console.error("Erreur transcrire avec AssemblyAI :", error.message);
    throw error;
  }
}

// ------------------------
// Streaming TTS Google Cloud
// ------------------------
async function streamGoogleTTS(text, res) {
  try {
    console.log(`[Google TTS] Génération TTS pour : ${text}`);
    const request = {
      input: { text },
      voice: { languageCode: 'fr-FR', ssmlGender: 'FEMALE' },
      audioConfig: { audioEncoding: 'MP3' },
    };

    const [response] = await ttsClient.synthesizeSpeech(request);
    console.log("[Google TTS] Audio généré (taille en bytes) :", response.audioContent.length);

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
// Processus complet Audio → AssemblyAI → GPT → TTS
// ------------------------
async function processAudioAndRespond(filePath, res) {
  try {
    console.log(`[ProcessAudio] Début traitement du fichier : ${filePath}`);
    
    // 1️⃣ Transcription
    const texteTranscrit = await transcribeWithAssembly(filePath);
    console.log(`[ProcessAudio] Texte transcrit : ${texteTranscrit}`);

    // 2️⃣ Appel à OpenAI pour obtenir la réponse
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-2025-04-14",
      messages: [{ role: "user", content: texteTranscrit }],
    });

    const gptResponse = completion.choices[0].message.content;
    console.log(`[ProcessAudio] Réponse GPT : ${gptResponse}`);

    // 3️⃣ Supprimer le fichier temporaire
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[ProcessAudio] Fichier temporaire supprimé : ${filePath}`);
    }

    // 4️⃣ Générer et streamer le TTS directement au front
    await streamGoogleTTS(gptResponse, res);

  } catch (error) {
    console.error("Erreur processAudioAndRespond :", error.message);
    res.status(500).send('Erreur traitement audio');
  }
}

module.exports = { transcribeWithAssembly, streamGoogleTTS, processAudio, processAudioAndRespond };
