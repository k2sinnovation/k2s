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
        const response = await axios.post(
            `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
            {
                input: { text },
                voice: { languageCode: 'fr-FR', name: 'fr-FR-Chirp3-HD-Leda', ssmlGender: 'FEMALE' },
                audioConfig: { audioEncoding: "LINEAR16" }
            }
        );
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
// Transcription AssemblyAI (buffer direct depuis Flutter)
// ------------------------
async function transcribeWithAssemblyBytes(audioBytes) {
    try {
        // Upload direct
        const uploadResp = await axios.post(
            'https://api.assemblyai.com/v2/upload',
            audioBytes,
            { headers: { authorization: process.env.ASSEMBLYAI_API_KEY, 'content-type': 'application/octet-stream' } }
        );
        const uploadUrl = uploadResp.data.upload_url;

        // Créer la transcription
        const transcriptResp = await axios.post(
            'https://api.assemblyai.com/v2/transcript',
            { audio_url: uploadUrl, speech_model: 'universal', language_code: 'fr' },
            { headers: { authorization: process.env.ASSEMBLYAI_API_KEY } }
        );

        const transcriptId = transcriptResp.data.id;

        // Polling pour récupérer le texte final
        while (true) {
            const result = await axios.get(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
                headers: { authorization: process.env.ASSEMBLYAI_API_KEY }
            });

            if (result.data.status === 'completed') return result.data.text;
            if (result.data.status === 'error') throw new Error(result.data.error);

            await new Promise(r => setTimeout(r, 3000));
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
    const audioBuffer = isBase64 ? decodeBase64Audio(fileOrBase64) : fileOrBase64;
    let texteTranscrit = "";
    let gptResponse = "";
    const audioSegments = [];

    console.log("[ProcessAudio] Début traitement audio direct...");

    // 1️⃣ Transcription
    try {
        texteTranscrit = await transcribeWithAssemblyBytes(audioBuffer);
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

    // 3️⃣ TTS - Segmentation phrases
    if (gptResponse) {
        try {
            const sentences = gptResponse
                .split(/(?<=[.!?])\s+/)
                .map(s => s.trim())
                .filter(s => s.length > 0);

            for (let i = 0; i < sentences.length; i++) {
                const segmentAudio = await generateGoogleTTSMP3(sentences[i]);
                if (segmentAudio) {
                    audioSegments.push({ index: i, text: sentences[i], audioBase64: segmentAudio });
                }
            }
        } catch (ttsError) {
            console.error("[ProcessAudio] Erreur TTS segmentée :", ttsError.message);
        }
    }

    return { transcription: texteTranscrit, gptResponse, audioSegments };
}

// ------------------------
// Export
// ------------------------
module.exports = {
    transcribeWithAssemblyBytes,
    generateGoogleTTSMP3,
    processAudioAndReturnJSON,
    decodeBase64Audio,
};
