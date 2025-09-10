const axios = require('axios');
const fs = require('fs');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { promptTTSVocal } = require('../utils/promptsTTSVocal');
const { getRandomWaitingMessage } = require('../utils/waitingMessages');

console.log("ASSEMBLYAI_API_KEY:", process.env.ASSEMBLYAI_API_KEY);

// ------------------------
// Google / SerpAPI Search
// ------------------------
async function googleSearch(query) {
    try {
        const response = await axios.get('https://serpapi.com/search', {
            params: { q: query, hl: 'fr', gl: 'fr', api_key: process.env.SERPAPI_API_KEY }
        });
        return response.data;
    } catch (err) {
        console.error("[SerpAPI] Erreur :", err.message);
        throw err;
    }
}

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
                audioConfig: { audioEncoding: "MP3" }
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
    if (!base64String) return Buffer.alloc(0);
    const base64Data = base64String.includes(',')
        ? base64String.split(',')[1]
        : base64String;
    return Buffer.from(base64Data, 'base64');
}

// ------------------------
// Transcription AssemblyAI
// ------------------------
async function transcribeWithAssembly(audioInput, isBase64 = false) {
    try {
        // Historique : toujours créer un buffer à partir du Base64 ou du fichier
const fileData = isBase64
    ? decodeBase64Audio(audioInput)    // conversion Base64 -> Buffer
    : fs.readFileSync(audioInput);     // lire le fichier directement

// Récupération de l'URL de l'upload
// ✅ Upload vers AssemblyAI
const uploadResponse = await axios.post(
    'https://api.assemblyai.com/v2/upload',
    fileData,
    {
        headers: {
            authorization: process.env.ASSEMBLYAI_API_KEY,
            'Content-Type': 'application/octet-stream'
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
    }
);

const uploadUrl = uploadResponse.data?.upload_url;
if (!uploadUrl) throw new Error("uploadUrl non reçu d'AssemblyAI");

console.log("[AssemblyAI] uploadUrl reçu :", uploadUrl);


        // Création transcription
const transcriptResponse = await axios.post(
    'https://api.assemblyai.com/v2/transcript',
    { audio_url: uploadUrl, speech_model: 'universal', language_code: 'fr' },
    { headers: { authorization: process.env.ASSEMBLYAI_API_KEY } }
);

const transcriptId = transcriptResponse.data?.id;
if (!transcriptId) throw new Error("Impossible de récupérer l'ID de transcription");

const pollingEndpoint = `https://api.assemblyai.com/v2/transcript/${transcriptId}`;


        const timeoutMs = 2 * 60 * 1000;
        const start = Date.now();
        while (true) {
            const result = await axios.get(pollingEndpoint, { headers: { authorization: process.env.ASSEMBLYAI_API_KEY } });
            if (result.data.status === 'completed') return result.data.text || "";
            if (result.data.status === 'error') throw new Error(result.data.error || "Erreur transcription AssemblyAI");
            if (Date.now() - start > timeoutMs) throw new Error("Timeout transcription AssemblyAI");
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    } catch (err) {
        console.error("[AssemblyAI] Erreur transcription :", err.message || err);
        throw err;
    }
}

// ------------------------
// Processus complet : Audio → AssemblyAI → GPT → TTS
// ------------------------
async function processAudioAndReturnJSON(fileOrBase64, deviceId, isBase64 = false) {
    const { sendToFlutter } = require('../websocket');
    
    let tempfilePath = fileOrBase64;
    if (isBase64) {
        tempfilePath = `./temp_${Date.now()}.mp3`;
        fs.writeFileSync(tempfilePath, decodeBase64Audio(fileOrBase64));
    }

    let texteTranscrit = "";
    let gptResponse = "";
    const audioSegments = [];

    // --- 0️⃣ Message d'attente ---
    try {
        const waitingText = getRandomWaitingMessage();
        const waitingAudio = await generateGoogleTTSMP3(waitingText);
        sendToFlutter({
            index: -1,
            text: waitingText,
            audioBase64: waitingAudio,
            mime: "audio/mpeg",
            deviceId
        }, deviceId);
    } catch (e) {
        console.error("[ProcessAudio] Message d'attente :", e.message);
    }

    // --- 1️⃣ Transcription ---
    try {
        texteTranscrit = await transcribeWithAssembly(tempfilePath);
        sendToFlutter({
            index: 0,
            text: texteTranscrit || "[transcription vide]",
            audioBase64: null,
            mime: "text/plain",
            deviceId
        }, deviceId);
    } catch (e) {
        console.error("[ProcessAudio] Transcription :", e.message);
    }

    // --- 2️⃣ Recherche Google approfondie ---
    let searchResultsSummary = '';
    try {
        const checkPrompt = `${promptTTSVocal} Est-ce une question technique ? Question: ${texteTranscrit}`;
        const checkCompletion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: checkPrompt }]
        });
        const doitChercher = checkCompletion.choices[0].message.content.trim().toUpperCase() === "OUI";
        if (doitChercher) {
            const searchData = await googleSearch(texteTranscrit);
            const results = searchData.organic_results?.slice(0, 3) || [];
            searchResultsSummary = results.map(r => `Titre: ${r.title}\nLien: ${r.link}\nSnippet: ${r.snippet}`).join('\n\n');
        }
    } catch (e) { console.error("[ProcessAudio] SerpAPI :", e.message); }

    // --- 3️⃣ GPT ---
    try {
        const enrichedPrompt = searchResultsSummary
            ? `${promptTTSVocal}\n\nInfos Google :\n${searchResultsSummary}\n\nQuestion: ${texteTranscrit}`
            : `${promptTTSVocal}\n\nQuestion: ${texteTranscrit}`;

        const completion = await openai.chat.completions.create({
            model: "gpt-5-chat-latest",
            messages: [
                { role: "system", content: enrichedPrompt },
                { role: "user", content: texteTranscrit || "[vide]" }
            ]
        });
        gptResponse = completion.choices[0].message.content;
    } catch (e) { console.error("[ProcessAudio] GPT :", e.message); }

    // --- 4️⃣ TTS segmenté ---
if (gptResponse) {
    const sentences = gptResponse.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);

    const audioSegments = await Promise.all(
        sentences.map(async (sentence, i) => {
            try {
                const audio = await generateGoogleTTSMP3(sentence);
                const payload = { index: i, text: sentence, audioBase64: audio, mime: 'audio/mpeg', deviceId };
                sendToFlutter(payload, deviceId);
                return payload;
            } catch (e) {
                console.error(`[ProcessAudio] TTS segment ${i}:`, e.message);
                return null;
            }
        })
    );

    // Nettoyage des segments échoués
    audioSegments.filter(Boolean).forEach(segment => audioSegments.push(segment));
}

// ------------------------
// Export
// ------------------------
module.exports = {
    transcribeWithAssembly,
    generateGoogleTTSMP3,
    decodeBase64Audio,
    googleSearch,
    processAudioAndReturnJSON
};
