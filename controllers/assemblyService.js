const fs = require('fs');
const axios = require('axios');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { promptTTSVocal } = require('../utils/promptsTTSVocal');

console.log("ASSEMBLYAI_API_KEY:", process.env.ASSEMBLYAI_API_KEY);

// Initialisation Google TTS
// Nouvelle version compatible clé API simple (REST)
async function generateGoogleTTSMP3(text) {
  try {
    const apiKey = process.env.K2S_IQ_Speech_API; // même nom que dans Render

    console.log("[Google TTS] Texte envoyé :", text);
    const response = await axios.post(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        input: { text },
        voice: { languageCode: 'fr-FR', ssmlGender: 'FEMALE' },
        audioConfig: { audioEncoding: "LINEAR16" } // <-- changement ici
      }
    );
    console.log("[Google TTS] Réponse reçue. Taille Base64 :", response.data.audioContent.length);

    // La réponse contient maintenant le TTS en Base64 wav
    return response.data.audioContent; 
  } catch (error) {
    console.error("Erreur TTS Google :", error);
    return null;
  }
}





// ------------------------
// Transcription AssemblyAI
// ------------------------

// ------------------------
// AJOUT : décodage Base64 → Buffer
// ------------------------

function decodeBase64Audio(base64String) {
  // Supprime le préfixe si présent (ex: "data:audio/mp3;base64,")
  const base64Data = base64String.replace(/^data:audio\/\w+;base64,/, '');
  return Buffer.from(base64Data, 'base64');
}

async function transcribeWithAssembly(audioInput, isBase64 = false) {
  try {
    console.log("[AssemblyAI] Préparation de l'audio...");
    const fileData = isBase64 ? decodeBase64Audio(audioInput) : fs.readFileSync(audioInput);

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

    // --- Polling pour récupérer la transcription ---
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

  } catch (err) {
    console.error("[AssemblyAI] Erreur lors du polling :", err.message);
    throw err;
  }
}


// ------------------------
// Processus complet Audio → AssemblyAI → GPT → TTS
// ------------------------
async function processAudioAndReturnJSON(fileOrBase64, isBase64 = false) {
  let tempfilePath   = fileOrBase64;

  if (isBase64) {
    // Création d'un fichier temporaire à partir du Base64
    tempfilePath     = `./temp_${Date.now()}.mp3`;
    fs.writeFileSync(tempfilePath    , decodeBase64Audio(fileOrBase64));
    console.log(`[ProcessAudio] Fichier temporaire créé à partir du Base64 : ${tempfilePath    }`);
  }
  let texteTranscrit = "";
  let gptResponse = "";
  let audioBase64 = null;

  console.log(`[ProcessAudio] Début traitement du fichier : ${tempfilePath    }`);

  // 1️⃣ Transcription AssemblyAI
  try {
    texteTranscrit = await transcribeWithAssembly(tempfilePath  );
    console.log(`[ProcessAudio] Texte transcrit : ${texteTranscrit}`);
  } catch (assemblyError) {
    console.error("Erreur AssemblyAI :", assemblyError.message);
    // on continue malgré l'erreur pour renvoyer ce qu'on a pu récupérer
  }

  // 2️⃣ GPT
// 2️⃣ GPT
try {
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


// 3️⃣ TTS
if (gptResponse) {
  try {

    // --- AJOUT : conversion explicite en UTF-8 ---
    cleanedText = Buffer.from(cleanedText, 'utf-8').toString();

    console.log(`[ProcessAudio] Texte envoyé à Google TTS : "${cleanedText}"`);
    audioBase64 = await generateGoogleTTSMP3(cleanedText);
    console.log(`[ProcessAudio] Audio Base64 généré. Taille : ${audioBase64.length}`);

  } catch (ttsError) {
    console.error("Erreur Google TTS (on continue) :", ttsError.message);
    audioBase64 = null;
  }
}



  // Suppression du fichier temporaire
  try {
    if (fs.existsSync(tempfilePath  )) fs.unlinkSync(tempfilePath  );
    console.log(`[ProcessAudio] Fichier temporaire supprimé : ${tempfilePath  }`);
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
  generateGoogleTTSMP3,
  processAudioAndReturnJSON,
};

