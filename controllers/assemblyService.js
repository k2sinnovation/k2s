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

    // Polling pour récupérer la transcription complète
    while (true) {
      const result = await axios.get(pollingEndpoint, { headers: { authorization: process.env.ASSEMBLYAI_API_KEY } });
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

  console.log("[ProcessAudio] Début traitement :", tempfilePath);

  // 1️⃣ Transcription
  try {
    texteTranscrit = await transcribeWithAssembly(tempfilePath);
    console.log("[ProcessAudio] Texte transcrit :", texteTranscrit);
  } catch (assemblyError) {
    console.error("[ProcessAudio] Erreur AssemblyAI :", assemblyError.message);
  }

// ------------------------
// Recherche Google via SerpAPI
// ------------------------
async function googleSearch(query) {
  try {
    const apiKey = process.env.SERPAPI_API_KEY; // 🔑 Clé stockée dans Render
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&hl=fr&gl=fr&api_key=${apiKey}`;
    const res = await axios.get(url);
    return res.data.organic_results?.slice(0, 3) || [];
  } catch (err) {
    console.error("[SerpAPI] Erreur recherche Google :", err.message);
    return [];
  }
}

// 2️⃣ GPT avec Function Calling conditionnelle

if (!texteTranscrit || texteTranscrit.trim() === "") {
  // Transcription vide → cycle d'origine
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-chat-latest",
      messages: [
        { role: "system", content: promptTTSVocal },
        { role: "user", content: texteTranscrit },
      ],
    });
    gptResponse = completion.choices[0].message.content;
    console.log("[ProcessAudio] Réponse GPT (texte vide) :", gptResponse);
  } catch (gptError) {
    console.error("[ProcessAudio] Erreur GPT :", gptError.message);
    gptResponse = "";
  }
} else {
  // Transcription non vide → Function Calling seulement si nécessaire
  async function callGPTWithFunction(texte) {
    const tools = [
      {
        type: "function",
        name: "google_search",
        description: "Recherche Google pour obtenir des infos récentes (météo, horaires, actualité, données techniques).",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"]
        }
      }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-5-chat-latest",
      messages: [
        { role: "system", content: promptTTSVocal },
        { role: "user", content: texte }
      ],
      tools
    });

    const toolCall = completion.choices[0].message?.tool_calls?.[0];

    if (toolCall && toolCall.function.name === "google_search") {
      // GPT a demandé une recherche
      const query = JSON.parse(toolCall.function.arguments).query;
      const searchResults = await googleSearch(query);

      const finalResponse = await openai.chat.completions.create({
        model: "gpt-5-chat-latest",
        messages: [
          { role: "system", content: promptTTSVocal },
          { role: "user", content: texte },
          completion.choices[0].message,
          {
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(searchResults),
          }
        ]
      });

      return finalResponse.choices[0].message.content;
    }

    // Pas d'appel de fonction → renvoie direct
    return completion.choices[0].message.content;
  }

  try {
    gptResponse = await callGPTWithFunction(texteTranscrit);
    console.log("[ProcessAudio] Réponse GPT :", gptResponse);
  } catch (err) {
    console.error("[ProcessAudio] Erreur GPT :", err.message);
    gptResponse = "";
  }
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

    // 2️⃣ Générer TTS pour chaque phrase et stocker dans audioSegments
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      console.log(`[ProcessAudio] Envoi phrase ${i + 1}/${sentences.length} à TTS :`, sentence);
      
      const segmentAudio = await generateGoogleTTSMP3(sentence);
      if (segmentAudio) {
        audioSegments.push({ index: i, text: sentence, audioBase64: segmentAudio });
        console.log(`[ProcessAudio] Phrase ${i + 1} convertie en audio. Taille Base64 :`, segmentAudio.length);

        // 3️⃣ Ici, on pourrait directement renvoyer ce segment à Flutter via websocket ou SSE
        // sendToFlutter(segmentAudio, i); // Exemple si tu veux streaming immédiat
      } else {
        console.error(`[ProcessAudio] Erreur TTS pour phrase ${i + 1}`);
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
};
