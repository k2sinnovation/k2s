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

        // 🔹 Étape 1 : convertir proprement en Buffer
let fileBuffer;
if (isBase64) {
    const base64Data = audioInput.includes('base64,')
        ? audioInput.split('base64,')[1]
        : audioInput;
    fileBuffer = Buffer.from(base64Data, 'base64');
} else {
    fileBuffer = Buffer.isBuffer(audioInput)
        ? audioInput
        : Buffer.from(audioInput);
}

        // 🔹 Étape 2 : upload AssemblyAI
        const uploadResponse = await axios.post(
            'https://api.assemblyai.com/v2/upload',
            fileBuffer,
            {
                headers: {
                    authorization: process.env.ASSEMBLYAI_API_KEY,
                    'content-type': 'application/octet-stream'
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            }
        );

        const uploadUrl = uploadResponse.data.upload_url;
        console.log("[AssemblyAI] Audio uploadé :", uploadUrl);

        // 🔹 Étape 3 : transcription
        const transcriptResponse = await axios.post(
            'https://api.assemblyai.com/v2/transcript',
            { audio_url: uploadUrl, speech_model: 'universal', language_code: 'fr' },
            { headers: { authorization: process.env.ASSEMBLYAI_API_KEY } }
        );

        const transcriptId = transcriptResponse.data.id;
        console.log("[AssemblyAI] ID transcription :", transcriptId);
        const pollingEndpoint = `https://api.assemblyai.com/v2/transcript/${transcriptId}`;

        // 🔹 Étape 4 : polling
        while (true) {
            const result = await axios.get(pollingEndpoint, {
                headers: { authorization: process.env.ASSEMBLYAI_API_KEY }
            });
            if (result.data.status === 'completed') return result.data.text;
            else if (result.data.status === 'error') throw new Error(result.data.error);
            await new Promise(resolve => setTimeout(resolve, 3000));
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
        texteTranscrit = await transcribeWithAssembly(fileOrBase64, isBase64);
        console.log("[ProcessAudio] Texte transcrit :", texteTranscrit);
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
    } catch (gptError) {
        console.error("[ProcessAudio] Erreur GPT :", gptError.message);
        gptResponse = "";
    }

    // 3️⃣ TTS - SEGMENTATION PHRASE
    if (gptResponse) {
        try {
            const sentences = gptResponse
                .split(/(?<=[.!?])\s+/)
                .map(s => s.trim())
                .filter(s => s.length > 0);
            console.log("[ProcessAudio] GPT découpé en phrases :", sentences);
            for (let i = 0; i < sentences.length; i++) {
                const sentence = sentences[i];
                console.log(`[ProcessAudio] Envoi phrase ${i + 1}/${sentences.length} à TTS :`, sentence);
                const segmentAudio = await generateGoogleTTSMP3(sentence);
                if (segmentAudio) {
                    audioSegments.push({ index: i, text: sentence, audioBase64: segmentAudio });
                    console.log(`[ProcessAudio] Phrase ${i + 1} convertie en audio. Taille Base64 :`, segmentAudio.length);
                } else {
                    console.error(`[ProcessAudio] Erreur TTS pour phrase ${i + 1}`);
                }
            }
        } catch (ttsError) {
            console.error("[ProcessAudio] Erreur TTS segmentée :", ttsError.message);
        }
    }

    // Plus besoin de suppression de fichier
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
