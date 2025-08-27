const axios = require('axios');
const fs = require('fs');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { promptTTSVocal } = require('../utils/promptsTTSVocal');
const { sendToFlutter } = require('../websocket'); // adapte le chemin si nécessaire
const { getRandomWaitingMessage } = require('../utils/waitingMessages');

console.log("ASSEMBLYAI_API_KEY:", process.env.ASSEMBLYAI_API_KEY);

// ------------------------
// SerpAPI Google Search
// ------------------------
async function googleSearch(query) {
    try {
        const response = await axios.get('https://serpapi.com/search', {
            params: {
                q: query,
                hl: 'fr',
                gl: 'fr',
                api_key: process.env.SERPAPI_API_KEY
            }
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
        let fileData;
        if (isBase64) {
            fileData = decodeBase64Audio(audioInput);
            console.log("[TRANSCRIBE] Input is base64 - bytes:", fileData.length);
        } else {
            if (!fs.existsSync(audioInput)) {
                console.error("[TRANSCRIBE] Fichier introuvable :", audioInput);
                throw new Error(`Fichier introuvable : ${audioInput}`);
            }
            fileData = fs.readFileSync(audioInput);
            console.log("[TRANSCRIBE] Lecture fichier :", audioInput, "taille:", fileData.length);
            if (fileData.length < 2000) {
                console.warn("[TRANSCRIBE] Fichier très petit, la transcription risque d'être vide !");
            }
        }

        // Upload audio
        const uploadResponse = await axios.post(
            'https://api.assemblyai.com/v2/upload',
            fileData,
            { headers: { authorization: process.env.ASSEMBLYAI_API_KEY, 'content-type': 'application/octet-stream' } }
        );
        const uploadUrl = uploadResponse.data.upload_url;
        console.log("[TRANSCRIBE] Upload réussi :", uploadUrl);

        // Créer transcription
        const transcriptResponse = await axios.post(
            'https://api.assemblyai.com/v2/transcript',
            { audio_url: uploadUrl, speech_model: 'universal' },
            { headers: { authorization: process.env.ASSEMBLYAI_API_KEY } }
        );
        const transcriptId = transcriptResponse.data.id;
        console.log("[TRANSCRIBE] ID transcription :", transcriptId);

        // Polling transcription
        const pollingEndpoint = `https://api.assemblyai.com/v2/transcript/${transcriptId}`;
        const start = Date.now();
        const timeoutMs = 2 * 60 * 1000;

        while (true) {
            const result = await axios.get(pollingEndpoint, { headers: { authorization: process.env.ASSEMBLYAI_API_KEY } });
            console.log("[TRANSCRIBE] Polling status:", result.data.status);

            if (result.data.status === 'completed') {
                console.log("[TRANSCRIBE] Transcription obtenue :", String(result.data.text).slice(0, 200));
                return result.data.text || "";
            } else if (result.data.status === 'error') {
                console.error("[TRANSCRIBE] Erreur AssemblyAI:", result.data.error);
                throw new Error(result.data.error || "Erreur transcription AssemblyAI");
            } else {
                if (Date.now() - start > timeoutMs) {
                    console.error("[TRANSCRIBE] Timeout transcription (>2min) pour id:", transcriptId);
                    throw new Error("Timeout transcription AssemblyAI");
                }
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
    } catch (err) {
        console.error("[AssemblyAI] Erreur transcription :", err && err.message ? err.message : err);
        throw err;
    }
}

// ------------------------
// Processus complet : Audio → AssemblyAI → GPT → TTS
// ------------------------
async function processAudioAndReturnJSON(fileOrBase64, deviceId = true, isBase64 = false) {
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
    if (!deviceId) {
        console.warn("[ProcessAudio] deviceId manquant, blocage message d'attente !");
        return { transcription: "", gptResponse: "", audioSegments: [] };
    }

    const waitingText = getRandomWaitingMessage();
    const waitingAudioBase64 = await generateGoogleTTSMP3(waitingText);

    const waitingPayload = {
        index: -1,
        text: waitingText,
        audioBase64: waitingAudioBase64,
        mime: "audio/mpeg",
        deviceId  // ajout explicite pour garder le lien
    };

    sendToFlutter(waitingPayload, deviceId);
} catch (waitingError) {
    console.error("[ProcessAudio] Erreur envoi message d'attente :", waitingError.message);
}


    // 1️⃣ Transcription
    try {
        texteTranscrit = await transcribeWithAssembly(tempfilePath);

if (!deviceId) {
    console.warn("[ProcessAudio] deviceId manquant, envoi annulé !");
    return { transcription: texteTranscrit || "", gptResponse: "", audioSegments: [] };
}


        // ⚡ Envoi transcription texte brute au client
sendToFlutter({
    index: 0,
    text: texteTranscrit || "[transcription vide]",
    audioBase64: null,
    mime: "text/plain",
    deviceId
}, deviceId);



        console.log("✅ Transcription AssemblyAI :", texteTranscrit ? texteTranscrit.slice(0,100) : "[vide]");

    } catch (assemblyError) {
        console.error("[ProcessAudio] Erreur AssemblyAI :", assemblyError.message);
    }

    // 2️⃣ Recherche Google si nécessaire
    let searchResultsSummary = '';
    try {
        const checkPrompt = `${promptTTSVocal} Est-ce une question technique ? Question: ${texteTranscrit}`;
        const checkCompletion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: checkPrompt }],
        });
        const doitChercher = checkCompletion.choices[0].message.content.trim().toUpperCase() === "OUI";
        if (doitChercher) {
            const searchData = await googleSearch(texteTranscrit);
            const results = searchData.organic_results?.slice(0, 3) || [];
            searchResultsSummary = results
                .map(r => `Titre: ${r.title}\nLien: ${r.link}\nSnippet: ${r.snippet}`)
                .join('\n\n');
        }
    } catch (err) {
        console.error("[ProcessAudio] Erreur SerpAPI :", err.message);
    }

    // 3️⃣ GPT
    try {
        const enrichedPrompt = searchResultsSummary
            ? `${promptTTSVocal}\n\nVoici des informations Google pertinentes pour compléter la réponse :\n${searchResultsSummary}\n\nQuestion: ${texteTranscrit}`
            : `${promptTTSVocal}\n\nQuestion: ${texteTranscrit}`;

        const completion = await openai.chat.completions.create({
            model: "gpt-5-chat-latest",
            messages: [
                { role: "system", content: enrichedPrompt },
                { role: "user", content: texteTranscrit || "[vide]" },
            ],
        });

        gptResponse = completion.choices[0].message.content;
        console.log("✅ Réponse GPT :", gptResponse ? gptResponse.slice(0,100) : "[vide]");

    } catch (gptError) {
        console.error("[ProcessAudio] Erreur GPT :", gptError.message);
        gptResponse = "";
    }

    // 4️⃣ TTS - Segmentation phrase
    if (gptResponse) {
        try {
            const sentences = gptResponse.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 0);
            for (let i = 0; i < sentences.length; i++) {
                console.log(`🔊 Segment ${i}:`, sentences[i]);
                const segmentAudio = await generateGoogleTTSMP3(sentences[i]);

                const payload = {
                    index: i,
                    text: sentences[i],
                    audioBase64: segmentAudio,
                    mime: 'audio/mpeg',
                    deviceId
                };

                audioSegments.push(payload);
                sendToFlutter(payload, deviceId);
            }
        } catch (ttsError) {
            console.error("[ProcessAudio] Erreur TTS segmentée :", ttsError.message);
        }
    }

    // Nettoyage fichier temporaire
    if (isBase64 && fs.existsSync(tempfilePath)) fs.unlinkSync(tempfilePath);

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
    googleSearch
};
