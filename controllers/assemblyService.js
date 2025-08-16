const fs = require('fs');
const axios = require('axios');
const textToSpeech = require('@google-cloud/text-to-speech');
const { PassThrough } = require('stream');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const promptTTSVocal = `Voici la transcription : ${transcription}`;

console.log("ASSEMBLYAI_API_KEY:", process.env.ASSEMBLYAI_API_KEY);

// Initialisation Google TTS
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  throw new Error("La variable GOOGLE_APPLICATION_CREDENTIALS_JSON n'est pas définie !");
}

const googleCredentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);


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

  try {
    console.log(`[ProcessAudio] Début traitement du fichier : ${filePath}`);
    texteTranscrit = await transcribeWithAssembly(filePath);
    console.log(`[ProcessAudio] Texte transcrit : ${texteTranscrit}`);

    const completion = await openai.chat.completions.create({
      model: "chatgpt-4o-latest",
      messages: [
        { role: "system", content: promptTTSVocal },
        { role: "user", content: texteTranscrit },
    ],
    });
    gptResponse = completion.choices[0].message.content;
    console.log(`[ProcessAudio] Réponse GPT : ${gptResponse}`);

    try {
      audioBase64 = await generateGoogleTTSBase64(gptResponse);
    } catch (ttsError) {
      console.error("Erreur Google TTS (on continue) :", ttsError.message);
      audioBase64 = null; // on continue malgré l'échec TTS
    }

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    console.log(`[ProcessAudio] Fichier temporaire supprimé : ${filePath}`);

  } catch (error) {
    console.error("Erreur processAudioAndReturnJSON :", error.message);
    // on continue pour renvoyer ce qu'on a pu traiter
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

