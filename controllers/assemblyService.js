const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Processus complet : segment audio → GPT-Realtime → réponse audio cohérente
 * @param {string} base64Segment - Segment audio encodé en Base64
 * @param {string} deviceId - ID du device
 * @param {function} sendToFlutter - Fonction pour envoyer le message au client
 */
async function processAudioSegment(base64Segment, deviceId, sendToFlutter) {
    if (!base64Segment || base64Segment.length === 0) {
        console.warn('[Realtime] Audio Base64 vide ou mal formé');
        return;
    }

    // Supprimer un éventuel préfixe "data:audio/wav;base64," si présent
    let base64Data = base64Segment.includes(',') ? base64Segment.split(',')[1] : base64Segment;
    const audioBuffer = Buffer.from(base64Data, 'base64');

    try {
        // 1️⃣ Envoyer le segment à GPT-Realtime
        const response = await openai.chat.completions.create({
            model: "gpt-realtime-2025-08-28",
            modalities: ["audio"],
            audio: audioBuffer,
            audio_format: "mp3",
            audio_voice: "Cedar",
            messages: [
                { role: "system", content: "Tu es un assistant vocal en français." },
                { role: "user", content: "Réponds à l'audio reçu" }
            ],
            stream: false
        });

        const gptAudioBase64 = response.choices[0].message.audio;
        const gptText = response.choices[0].message.content || "";

        // 2️⃣ Envoi immédiat vers Flutter via la fonction passée en paramètre
        sendToFlutter({
            index: Date.now(),
            text: gptText,
            audioBase64: gptAudioBase64,
            mime: 'audio/mpeg',
            deviceId
        }, deviceId);

        return {
            transcription: "[Direct Realtime]",
            gptResponse: gptText,
            audioSegments: [{ audioBase64: gptAudioBase64, text: gptText }]
        };

    } catch (err) {
        console.error("[Realtime] GPT error :", err);
        return { transcription: "", gptResponse: "", audioSegments: [] };
    }
}

module.exports = { processAudioSegment };
