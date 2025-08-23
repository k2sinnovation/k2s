const fs = require('fs');
const axios = require('axios');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { promptTTSVocal } = require('../utils/promptsTTSVocal');

console.log("ASSEMBLYAI_API_KEY:", process.env.ASSEMBLYAI_API_KEY);

// ------------------------
// Google TTS
// ------------------------
async function generateGoogleTTSMP3(text) {
  try {
    const apiKey = process.env.K2S_IQ_Speech_API;
    console.log("[Google TTS] Texte envoyé :", text);

    const response = await axios.post(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        input: { text },
        voice: { languageCode: 'fr-FR', name: 'fr-FR-Chirp3-HD-Leda', ssmlGender: 'FEMALE' },
        audioConfig: { audioEncoding: "LINEAR16" }
      }
    );

    console.log("[Google TTS] Réponse reçue. Taille Base64 :", response.data.audioContent.length);
    return response.data.audioContent;
  } catch (error) {
    console.error("[Google TTS] Erreur :", error.message);
    return null;
  }
}

// ------------------------
// Décodage Base64
// ------------------------
function decodeBase64Audio(base64String) {
  const base64Data = base64String.replace(/^data:audio\/\w+;base64,/, '');
  return Buffer.from(base64Data, 'base64');
}

// ------------------------
// Transcription AssemblyAI
// ------------------------
async function transcribeWithAssembly(audioInput, isBase64 = false) {
  try {
    console.log("[AssemblyAI] Préparation de l'audio...");
    const fileData = isBase64 ? decodeBase64Audio(audioInput) : fs.readFileSync(audioInput);

    const uploadResponse = await axios.post(
      'https://api.assemblyai.com/v2/upload',
      fileData,
      { headers: { authorization: process.env.ASSEMBLYAI_API_KEY, 'content-type': 'application/octet-stream' } }
    );

    const uploadUrl = uploadResponse.data.upload_url;
    console.log("[AssemblyAI] Audio uploadé :", uploadUrl);

    const transcriptResponse = await axios.post(
      'https://api.assemblyai.com/v2/transcript',
      { audio_url: uploadUrl, speech_model: 'universal', language_code: 'fr' },
      { headers: { authorization: process.env.ASSEMBLYAI_API_KEY } }
    );

    const transcriptId = transcriptResponse.data.id;
    console.log("[AssemblyAI] ID transcription :", transcriptId);

    const pollingEndpoint = `https://api.assemblyai.com/v2/transcript/${transcriptId}`;

    while (true) {
      const result = await axios.get(pollingEndpoint, { headers: { authorization: process.env.ASSEMBLYAI_API_KEY } });
      if (result.data.status === 'completed') return result.data.text;
      if (result.data.status === 'error') throw new Error(result.data.error);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  } catch (err) {
    console.error("[AssemblyAI] Erreur transcription :", err.message);
    throw err;
  }
}

// ------------------------
// Processus complet : Audio → AssemblyAI → GPT → TTS
// ------------------------
async function processAudioAndReturnJSON(fileOrBase64, isBase64 = false, onSegmentReady = null) {
  let tempfilePath = fileOrBase64;

  if (isBase64) {
    tempfilePath = `./temp_${Date.now()}.mp3`;
    fs.writeFileSync(tempfilePath, decodeBase64Audio(fileOrBase64));
    console.log("[ProcessAudio] Fichier temporaire créé :", tempfilePath);
  }

  let texteTranscrit = "";
  let gptResponse = "";
  const audioSegments = [];

  // 1️⃣ Transcription
  try {
    texteTranscrit = await transcribeWithAssembly(tempfilePath);
    console.log("[ProcessAudio] Texte transcrit :", texteTranscrit);
  } catch (assemblyError) {
    console.error("[ProcessAudio] Erreur AssemblyAI :", assemblyError.message);
  }

  // 2️⃣ GPT
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-chat-latest",
      messages: [{ role: "system", content: promptTTSVocal }, { role: "user", content: texteTranscrit }],
    });
    gptResponse = completion.choices[0].message.content;
    console.log("[ProcessAudio] Réponse GPT :", gptResponse);
  } catch (gptError) {
    console.error("[ProcessAudio] Erreur GPT :", gptError.message);
    gptResponse = "";
  }

  // 3️⃣ TTS - Segmenté et envoi immédiat si callback
  if (gptResponse) {
    try {
      const sentences = gptResponse.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 0);
      console.log("[ProcessAudio] GPT découpé en phrases :", sentences);

      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        console.log(`[ProcessAudio] Envoi phrase ${i + 1}/${sentences.length} à TTS :`, sentence);

        const segmentAudio = await generateGoogleTTSMP3(sentence);
        if (segmentAudio) {
          const segment = { index: i, text: sentence, audioBase64: segmentAudio };
          audioSegments.push(segment);
          if (onSegmentReady) onSegmentReady(segment); // 🔥 Envoi direct
        }
      }

      if (onSegmentReady) onSegmentReady({ done: true }); // signal fin
    } catch (ttsError) {
      console.error("[ProcessAudio] Erreur TTS segmentée :", ttsError.message);
    }
  }

  // Nettoyage fichier temporaire
  try { if (fs.existsSync(tempfilePath)) fs.unlinkSync(tempfilePath); } catch (fsError) {
    console.error("[ProcessAudio] Erreur suppression fichier :", fsError.message);
  }

  return { transcription: texteTranscrit, gptResponse, audioSegments };
}

// ------------------------
// Export
// ------------------------
module.exports = {
  transcribeWithAssembly,
  generateGoogleTTSMP3,
  processAudioAndReturnJSON,
  decodeBase64Audio,
};
