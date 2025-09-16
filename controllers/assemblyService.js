const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { sendToFlutter } = require('../websocket'); // ton module websocket

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
 * @param {boolean} sendToFlutterFlag - envoyer le résultat au device
 */
async function processAudioAndReturnJSON(audioBase64, deviceId, sendToFlutterFlag = true) {
  let tempFilePath = null;
  try {
    // Extraire le buffer
    const base64Data = audioBase64.includes(',') ? audioBase64.split(',')[1] : audioBase64;
    const audioBuffer = Buffer.from(base64Data, 'base64');

    // Sauvegarde temporaire (optionnel)
    tempFilePath = saveTempAudio(audioBuffer);

    // Initialiser OpenAI
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // 🔹 Transcrire l'audio reçu
    const transcription = await client.audio.transcriptions.create({
      file: audioBuffer,
      model: "gpt-4o-mini-transcribe", // ou gpt-4o-mini-transcribe, selon tes besoins
    });

    const textResult = transcription.text || "";

    console.log(`[assemblyService] Transcription pour ${deviceId}:`, textResult);

    // Envoyer le texte au device si demandé
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
    // Supprimer le fichier temporaire
    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
  }
}

// ⚠️ Export CommonJS
module.exports = { processAudioAndReturnJSON };
