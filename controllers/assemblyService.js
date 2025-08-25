const axios = require('axios');
const fs = require('fs');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const { promptTTSVocal } = require('../utils/promptsTTSVocal');
const { sendToFlutter } = require('../websocket'); // adapte le chemin si nécessaire

console.log("ASSEMBLYAI_API_KEY:", process.env.ASSEMBLYAI_API_KEY);


// ------------------------
// SerpAPI Google Search (version compatible Node.js v24)
// ------------------------

console.log("[SerpAPI] Module axios prêt pour requêtes SerpAPI");

// ------------------------
// Fonction pour rechercher sur Google via SerpAPI
// ------------------------
async function googleSearch(query) {
  console.log("[SerpAPI] Recherche pour :", query);

  try {
    const response = await axios.get('https://serpapi.com/search', {
      params: {
        q: query,
        hl: 'fr', // langue
        gl: 'fr', // localisation
        api_key: process.env.SERPAPI_API_KEY
      }
    });

    if (!response.data) {
      console.error("[SerpAPI] Pas de données reçues");
      throw new Error("Aucune donnée reçue de SerpAPI");
    }

    console.log("[SerpAPI] Résultats reçus, nombre approx. :", response.data.organic_results?.length || 0);
    return response.data;

  } catch (err) {
    console.error("[SerpAPI] Erreur lors de la recherche :", err.message);
    throw err;
  }
}


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
        voice: {
          languageCode: 'fr-FR',
          name: 'fr-FR-Chirp3-HD-Leda',
          ssmlGender: 'FEMALE'
        },
        audioConfig: { audioEncoding: "MP3" }
      }
    );

    const base64 = response.data.audioContent; // MP3 en base64
    console.log("[Google TTS] MP3 Base64 length:", base64?.length || 0);
    return base64;

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
      {
        headers: {
          authorization: process.env.ASSEMBLYAI_API_KEY,
          'content-type': 'application/octet-stream'
        }
      }
    );

    const uploadUrl = uploadResponse.data.upload_url;
    console.log("[AssemblyAI] Audio uploadé :", uploadUrl);

    const transcriptResponse = await axios.post(
      'https://api.assemblyai.com/v2/transcript',
      {
        audio_url: uploadUrl,
        speech_model: 'universal',
        language_code: 'fr'
      },
      {
        headers: { authorization: process.env.ASSEMBLYAI_API_KEY }
      }
    );

    const transcriptId = transcriptResponse.data.id;
    console.log("[AssemblyAI] ID transcription :", transcriptId);

    const pollingEndpoint = `https://api.assemblyai.com/v2/transcript/${transcriptId}`;

    // Polling pour récupérer la transcription complète
    while (true) {
      const result = await axios.get(pollingEndpoint, {
        headers: { authorization: process.env.ASSEMBLYAI_API_KEY }
      });

      if (result.data.status === 'completed') {
        console.log("[AssemblyAI] Transcription terminée :", result.data.text);
        return result.data.text;

      } else if (result.data.status === 'error') {
        throw new Error(result.data.error);

      } else {
        console.log("[AssemblyAI] Transcription en cours...");
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  } catch (err) {
    console.error("[AssemblyAI] Erreur transcription :", err.message);
    throw err;
  }
}

// ------------------------
// Processus complet : Audio → AssemblyAI → GPT → TTS
// ------------------------
async function processAudioAndReturnJSON(fileOrBase64, isBase64 = false) {
  let tempfilePath = fileOrBase64;

  if (isBase64) {
    tempfilePath = `./temp_${Date.now()}.mp3`;
    fs.writeFileSync(tempfilePath, decodeBase64Audio(fileOrBase64));
    console.log("[ProcessAudio] Fichier temporaire créé :", tempfilePath);
  }

  let texteTranscrit = "";
  let gptResponse = "";
  let audioBase64 = null;

const { getRandomWaitingMessage } = require('../utils/waitingMessages'); // <-- Ajout import

console.log("[ProcessAudio] Début traitement :", tempfilePath);

// --- 0️⃣ Envoyer message d'attente aléatoire immédiatement ---
try {
  const waitingText = getRandomWaitingMessage();
  console.log("[ProcessAudio] Message d'attente choisi :", waitingText);

  const waitingAudioBase64 = await generateGoogleTTSMP3(waitingText);

  sendToFlutter({
    index: -1,             // index négatif pour indiquer message d'attente
    text: "",              // on n'envoie pas le texte
    audioBase64: waitingAudioBase64,
    mime: "audio/mpeg"
  });

  console.log("[ProcessAudio] Message d'attente envoyé via WebSocket");

} catch (waitingError) {
  console.error("[ProcessAudio] Erreur envoi message d'attente :", waitingError.message);
}

// 1️⃣ Transcription
try {
  texteTranscrit = await transcribeWithAssembly(tempfilePath);
  console.log("[ProcessAudio] Texte transcrit :", texteTranscrit);
} catch (assemblyError) {
  console.error("[ProcessAudio] Erreur AssemblyAI :", assemblyError.message);
}


// 2️⃣ Vérifier si une recherche Google est nécessaire
let searchResultsSummary = '';
try {
  const checkSearchPrompt = `
${promptTTSVocal}
Dis-moi simplement : cette question nécessite-t-elle une recherche Google pour répondre correctement ?
Répond uniquement par OUI ou NON.
Question : ${texteTranscrit}
`;

  const checkCompletion = await openai.chat.completions.create({
    model: "gpt-5-chat-latest",
    messages: [{ role: "user", content: checkSearchPrompt }],
  });

  const doitChercher = checkCompletion.choices[0].message.content.trim().toUpperCase() === "OUI";

  if (doitChercher) {
    const searchData = await googleSearch(texteTranscrit);
    const results = searchData.organic_results?.slice(0, 3) || [];
    searchResultsSummary = results
      .map(r => `Titre: ${r.title}\nLien: ${r.link}\nSnippet: ${r.snippet}`)
      .join('\n\n');
    console.log("[ProcessAudio] Résumés Google :", searchResultsSummary);
  } else {
    console.log("[ProcessAudio] Pas de recherche Google nécessaire.");
  }

} catch (err) {
  console.error("[ProcessAudio] Erreur vérification/SerpAPI :", err.message);
}

// 3️⃣ GPT avec ou sans enrichissement Google
try {
  const enrichedPrompt = searchResultsSummary
    ? `${promptTTSVocal}\n\nVoici des informations Google pertinentes pour compléter la réponse :\n${searchResultsSummary}\n\nQuestion: ${texteTranscrit}`
    : `${promptTTSVocal}\n\nQuestion: ${texteTranscrit}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-5-chat-latest",
    messages: [
      { role: "system", content: enrichedPrompt },
      { role: "user", content: texteTranscrit },
    ],
  });

  gptResponse = completion.choices[0].message.content;
  console.log("[ProcessAudio] Réponse GPT :", gptResponse);

} catch (gptError) {
  console.error("[ProcessAudio] Erreur GPT :", gptError.message);
  gptResponse = "";
}


  // 3️⃣ TTS - SEGMENTATION PHRASE
  const audioSegments = []; // Tableau pour stocker chaque segment audio Base64

  if (gptResponse) {
    try {
      // 1️⃣ Découper le texte GPT en phrases
      const sentences = gptResponse
        .split(/(?<=[.!?])\s+/) // Regex pour couper sur . ! ? suivi d'espace
        .map(s => s.trim())
        .filter(s => s.length > 0);

      console.log("[ProcessAudio] GPT découpé en phrases :", sentences);

      // 2️⃣ Générer TTS pour chaque phrase et envoyer directement à Flutter via service WS
      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        console.log(`[ProcessAudio] Envoi phrase ${i + 1}/${sentences.length} à TTS :`, sentence);

        const segmentAudio = await generateGoogleTTSMP3(sentence);

        if (segmentAudio) {
          const payload = {
            index: i,
            text: sentence,
            audioBase64: segmentAudio,
            mime: 'audio/mpeg'
          };

          audioSegments.push(payload);
          console.log(`[ProcessAudio] MP3 Base64 size phrase ${i + 1}:`, segmentAudio.length);

          // --- Envoi via service WebSocket Render ---
         sendToFlutter(payload);

        } else {
          console.error(`[ProcessAudio] Erreur TTS phrase ${i + 1}`);
        }
      }

    } catch (ttsError) {
      console.error("[ProcessAudio] Erreur TTS segmentée :", ttsError.message);
    }
  }

  // Nettoyage fichier temporaire
  try {
    if (fs.existsSync(tempfilePath)) fs.unlinkSync(tempfilePath);
    console.log("[ProcessAudio] Fichier temporaire supprimé :", tempfilePath);
  } catch (fsError) {
    console.error("[ProcessAudio] Erreur suppression fichier :", fsError.message);
  }

  // On remplace audioBase64 par audioSegments pour l'envoi à Flutter
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
  sendToFlutter,
  googleSearch,
};
