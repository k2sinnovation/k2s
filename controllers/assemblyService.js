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
 */
async function processAudioAndReturnJSON(audioBase64, deviceId, sendToFlutterFlag = true) {
  const { sendToFlutter } = require('../websocket'); // 🔹 Déplacement ici pour éviter circularité
  let tempFilePath = null;

  try {
    const base64Data = audioBase64.includes(',') ? audioBase64.split(',')[1] : audioBase64;
    const audioBuffer = Buffer.from(base64Data, 'base64');

    // Sauvegarde temporaire
    tempFilePath = saveTempAudio(audioBuffer);

    // Initialiser OpenAI
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Exemple : transcrire l'audio
    const transcription = await client.audio.transcriptions.create({
      file: audioBuffer,
      model: "gpt-4o-realtime-preview-2025-06-03"  
    });

    const textResult = transcription.text || "";

    // Envoyer à Flutter si demandé
    if (sendToFlutterFlag) {
      sendToFlutter({
        deviceId,
        text: textResult,
        index: Date.now(),
      }, deviceId);
    }

    return { status: "ok", deviceId, text: textResult };

  } catch (err) {
    console.error(`[assemblyService] Erreur pour ${deviceId}:`, err.message);
    return { status: "error", deviceId, message: err.message };
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
  }
}

// Export CommonJS
module.exports = { processAudioAndReturnJSON };
