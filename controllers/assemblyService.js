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
// Transcription AssemblyAI (sans fichier local)
// ------------------------
async function transcribeWithAssembly(audioInput, isBase64 = false) {
    try {
        console.log("[AssemblyAI] Préparation de l'audio...");
        // On utilise directement le buffer, plus de lecture fichier
        const fileData = isBase64 ? decodeBase64Audio(audioInput) : audioInput;

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
            { audio_url: uploadUrl, speech_model: 'universal', language_code: 'fr' },
            { headers: { authorization: process.env.ASSEMBLYAI_API_KEY } }
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
// Processus complet : Audio → AssemblyAI → GPT → TTS (sans fichier temporaire)
// ------------------------
async function processAudioAndReturnJSON(fileOrBase64, isBase64 = false) {
    // On convertit directement en Buffer si base64
    const audioBuffer = isBase64 ? decodeBase64Audio(fileOrBase64) : fileOrBase64;

    let texteTranscrit = "";
    let gptResponse = "";
    const audioSegments = [];

    console.log("[ProcessAudio] Début traitement audio direct...");

// 1️⃣ Transcription
try {
    texteTranscrit = await transcribeWithAssembly(audioBuffer, false);
    console.log("[ProcessAudio] Texte transcrit :", texteTranscrit);

    // 🔹 Renvoi immédiat au frontend ou appel callback
    if (typeof onTranscriptionReady === "function") {
        onTranscriptionReady(texteTranscrit);
    }

} catch (assemblyError) {
    console.error("[ProcessAudio] Erreur AssemblyAI :", assemblyError.message);
}

// 2️⃣ GPT
try {
    const completion = await openai.chat.completions.create({
        model: "gpt-5-chat-latest",
        messages: [
            { role: "system", content: promptTTSVocal },
            { role: "user", content: texteTranscrit },
        ],
    });
    gptResponse = completion.choices[0].message.content;
    console.log("[ProcessAudio] Réponse GPT :", gptResponse);

    // 🔹 Renvoi immédiat de la réponse GPT
    if (typeof onGPTResponseReady === "function") {
        onGPTResponseReady(gptResponse);
    }

} catch (gptError) {
    console.error("[ProcessAudio] Erreur GPT :", gptError.message);
    gptResponse = "";
}

// 3️⃣ TTS ...
// Tu peux continuer la génération TTS phrase par phrase
// et renvoyer chaque segment dès qu'il est prêt
for (let i = 0; i < sentences.length; i++) {
    const segmentAudio = await generateGoogleTTSMP3(sentences[i]);
    if (segmentAudio && typeof onTTSSegmentReady === "function") {
        onTTSSegmentReady(i, segmentAudio, sentences[i]);
    }
}

// On peut toujours retourner tout à la fin si besoin
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
