const fs = require('fs');
const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Processus complet : Audio → GPT-Realtime → réponse audio cohérente
 */
async function processAudioAndReturnJSON(fileOrBase64, deviceId, isBase64 = false) {
    const { sendToFlutter } = require('../websocket');

    // 1️⃣ Préparer le buffer audio
    let audioBuffer;
    if (isBase64) {
        audioBuffer = Buffer.from(fileOrBase64.split(',')[1], 'base64');
    } else {
        audioBuffer = fs.readFileSync(fileOrBase64);
    }

    // 2️⃣ Envoyer l’audio à GPT-Realtime et récupérer la réponse audio complète
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-realtime-2025-08-28",
            modalities: ["audio"],      // audio input + output
            audio: audioBuffer,          // ton fichier audio
            audio_format: "mp3",         // ou "wav" si besoin
            audio_voice: "Cedar",        // ou "Marin"
            messages: [
                { role: "system", content: "Tu es un assistant vocal en français." },
                { role: "user", content: "Réponds à l'audio reçu" }
            ],
            stream: false                // réponse complète et cohérente
        });

        const gptAudioBase64 = response.choices[0].message.audio;
        const gptText = response.choices[0].message.content || "";

        // 3️⃣ Envoi vers Flutter
        sendToFlutter({
            index: 0,
            text: gptText,
            audioBase64: gptAudioBase64,
            mime: 'audio/mpeg',
            deviceId
        }, deviceId);

        // 4️⃣ Retour final pour Express
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

module.exports = { processAudioAndReturnJSONRealtime };
