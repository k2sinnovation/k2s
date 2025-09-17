const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

function saveTempAudio(buffer) {
  if (!fs.existsSync("./uploads")) fs.mkdirSync("./uploads");
  const fileName = `${Date.now()}-${Math.floor(Math.random() * 10000)}.wav`;
  const filePath = path.join("./uploads", fileName);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function processAudioAndReturnJSON(audioBase64, deviceId, sendToFlutterFlag = true) {
  const { sendToFlutter } = require('../websocket');
  let tempFilePath = null;

  try {
    const base64Data = audioBase64.includes(',') ? audioBase64.split(',')[1] : audioBase64;
    const audioBuffer = Buffer.from(base64Data, 'base64');

    // Sauvegarde temporaire
    tempFilePath = saveTempAudio(audioBuffer);

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // ✅ Transcrire via fichier temporaire
    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: "gpt-4o-realtime-preview-2025-06-03"
    });

    const textResult = transcription.text || "";

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

module.exports = { processAudioAndReturnJSON };
