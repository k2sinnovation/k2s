const fs = require('fs');
const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Processus complet : Audio → GPT-Realtime → réponse audio cohérente
 */
async function processAudioAndReturnJSON(fileOrBase64, deviceId, isBase64 = false) {
    const { sendToFlutter } = require('../websocket');

    // 1️⃣ Préparer le buffer audio segmenté
    let audioBuffer;
    if (isBase64) {
        const parts = fileOrBase64.split(',');
        if (!parts[1]) {
            console.warn('[Realtime] Audio Base64 vide ou mal formé');
            return;
        }
        audioBuffer = Buffer.from(parts[1], 'base64');
    } else {
        audioBuffer = fs.readFileSync(fileOrBase64);
    }

    // 2️⃣ Envoyer le segment à GPT-Realtime
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-realtime-2025-08-28",
            modalities: ["audio"],
            audio: audioBuffer,
            audio_format: "mp3",
            audio_voice: "Cedar",
            messages: [
                { role: "system", content: "Tu es un assistant vocal en français." },
                { role: "user", content: "Réponds à ce segment audio" }
            ],
            stream: false
        });

        const gptAudioBase64 = response.choices[0].message.audio;
        const gptText = response.choices[0].message.content || "";

        // 3️⃣ Envoi segment par segment vers Flutter
        sendToFlutter({
            index: Date.now(), // timestamp unique pour chaque segment
            text: gptText,
            audioBase64: gptAudioBase64,
            mime: 'audio/mpeg',
            deviceId
        }, deviceId);

        // 4️⃣ Retour segment
        return {
            transcription: "[Segment Realtime]",
            gptResponse: gptText,
            audioSegments: [{ audioBase64: gptAudioBase64, text: gptText }]
        };

    } catch (err) {
        console.error("[Realtime] GPT error :", err);
        return { transcription: "", gptResponse: "", audioSegments: [] };
    }
}


module.exports = { processAudioAndReturnJSON };
