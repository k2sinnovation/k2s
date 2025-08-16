const fs = require('fs');
const axios = require('axios');
const textToSpeech = require('@google-cloud/text-to-speech');
const { PassThrough } = require('stream');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

console.log("ASSEMBLYAI_API_KEY:", process.env.ASSEMBLYAI_API_KEY);

// Initialisation Google TTS
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  throw new Error("La variable GOOGLE_APPLICATION_CREDENTIALS_JSON n'est pas définie !");
}

const googleCredentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

// --- AJOUT : création du client TTS ---
const ttsClient = new textToSpeech.TextToSpeechClient({
  credentials: googleCredentials,
});



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

    console.log("[AssemblyAI] Création de la transcription...");
    const transcriptResponse = await axios.post(
      'https://api.assemblyai.com/v2/transcript',
      { audio_url: uploadUrl, speech_model: 'universal', language_code: 'fr' },
      { headers: { authorization: process.env.ASSEMBLYAI_API_KEY } }
    );

    const transcriptId = transcriptResponse.data.id;
    console.log(`[AssemblyAI] ID transcription : ${transcriptId}`);
    const pollingEndpoint = `https://api.assemblyai.com/v2/transcript/${transcriptId}`;

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

async function generateGoogleTTSBase64(text) {
  try {
    console.log(`[Google TTS] Génération TTS pour : ${text}`);
    const request = {
      input: { text },
      voice: { languageCode: 'fr-FR', ssmlGender: 'FEMALE' },
      audioConfig: { audioEncoding: 'MP3' },
    };

    const [response] = await ttsClient.synthesizeSpeech(request);
    return response.audioContent.toString('base64');
  } catch (error) {
    console.error("Erreur Google TTS :", error.message);
    throw error;
  }
}

// ------------------------
// Processus complet Audio → AssemblyAI → GPT → TTS
// ------------------------
async function processAudioAndReturnJSON(filePath) {
  let texteTranscrit = "";
  let gptResponse = "";
  let audioBase64 = null;

  console.log(`[ProcessAudio] Début traitement du fichier : ${filePath}`);

  // 1️⃣ Transcription AssemblyAI
  try {
    texteTranscrit = await transcribeWithAssembly(filePath);
    console.log(`[ProcessAudio] Texte transcrit : ${texteTranscrit}`);
  } catch (assemblyError) {
    console.error("Erreur AssemblyAI :", assemblyError.message);
    // on continue malgré l'erreur pour renvoyer ce qu'on a pu récupérer
  }

  // 2️⃣ GPT
  if (texteTranscrit) {
    try {
      const promptTTSVocal = `Voici la transcription à analyser : ${texteTranscrit}`;
      const completion = await openai.chat.completions.create({
        model: "chatgpt-4o-latest",
        messages: [
          { role: "system", content: promptTTSVocal },
          { role: "user", content: texteTranscrit },
        ],
      });
      gptResponse = completion.choices[0].message.content;
      console.log(`[ProcessAudio] Réponse GPT : ${gptResponse}`);
    } catch (gptError) {
      console.error("Erreur GPT (on continue) :", gptError.message);
      gptResponse = "";
    }
  }

  // 3️⃣ TTS
  if (gptResponse) {
    try {
      audioBase64 = await generateGoogleTTSBase64(gptResponse);
    } catch (ttsError) {
      console.error("Erreur Google TTS (on continue) :", ttsError.message);
      audioBase64 = null;
    }
  }

  // Suppression du fichier temporaire
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    console.log(`[ProcessAudio] Fichier temporaire supprimé : ${filePath}`);
  } catch (fsError) {
    console.error("Erreur suppression fichier :", fsError.message);
  }

  return { transcription: texteTranscrit, gptResponse, audioBase64 };
}




// ------------------------
// Export
// ------------------------
module.exports = {
  transcribeWithAssembly,
  generateGoogleTTSBase64,
  processAudioAndReturnJSON,
};

