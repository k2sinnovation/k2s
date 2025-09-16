const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

// Sauvegarde temporaire du fichier audio
function saveTempAudio(buffer) {
  if (!fs.existsSync("./uploads")) fs.mkdirSync("./uploads");
  const fileName = `${Date.now()}-${Math.floor(Math.random() * 10000)}.wav`;
  const filePath = path.join("./uploads", fileName);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/**
 * Traite l'audio reçu en Base64 depuis Flutter
 * @param {string} audioBase64 - Base64 du segment WAV
 * @param {string} deviceId - ID du device Flutter
 * @param {function} sendToFlutterFn - fonction pour renvoyer l'audio au device
 */
async function processAudioAndReturnJSON(audioBase64, deviceId, sendToFlutterFn = null) {
  let tempFilePath = null;
  try {
    // Extraire le buffer
    const base64Data = audioBase64.includes(',') ? audioBase64.split(',')[1] : audioBase64;
    const audioBuffer = Buffer.from(base64Data, 'base64');

    // Sauvegarde temporaire (optionnel)
    tempFilePath = saveTempAudio(audioBuffer);

    // ✅ Initialiser OpenAI
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Exemple : générer audio de réponse via Realtime
    const session = await client.realtime.sessions.create({
      model: "gpt-realtime-2025-08-28",
      voice: "alloy"
    });

    const response = await client.realtime.responses.create({
      session: session.id,
      input: [{
        role: "user",
        content: [{ type: "input_audio", audio: audioBuffer.toString("base64") }]
      }]
    });

    // Extraire le Base64 de sortie
    let audioOutBase64 = null;
    for (const out of response.output) {
      for (const item of out.content) {
        if (item.type === "output_audio") audioOutBase64 = item.audio;
      }
    }

    // Envoyer à Flutter si demandé
    if (audioOutBase64 && sendToFlutterFn) {
      sendToFlutterFn({
        deviceId,
        audioBase64: audioOutBase64,
        index: Date.now(),
      }, deviceId);
    }

    return { status: "ok", deviceId };

  } catch (err) {
    console.error(`[assemblyService] Erreur pour ${deviceId}:`, err.message);
    return { status: "error", deviceId, message: err.message };
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
  }
}

// ⚠️ Export CommonJS
module.exports = { processAudioAndReturnJSON };
