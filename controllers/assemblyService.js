import fs from "fs";
import path from "path";
import OpenAI from "openai";

/**
 * Crée un fichier temporaire sûr pour l'audio
 */
function saveTempAudio(audioBuffer) {
  if (!fs.existsSync("./uploads")) fs.mkdirSync("./uploads");
  const tempFileName = `${Date.now()}-${Math.floor(Math.random() * 10000)}.wav`;
  const tempFilePath = path.join("./uploads", tempFileName);
  fs.writeFileSync(tempFilePath, audioBuffer);
  return tempFilePath;
}

/**
 * Traite l'audio et renvoie le résultat au client Flutter
 */
export async function processAudioAndReturnJSON(fileOrBase64, deviceId, sendToFlutter, isBase64 = false) {
  let audioBuffer;
  let tempFilePath = null;

  try {
    if (isBase64) {
      // Convertir Base64 en Buffer
      const base64Data = fileOrBase64.includes(",") ? fileOrBase64.split(",")[1] : fileOrBase64;
      audioBuffer = Buffer.from(base64Data, "base64");
      // Créer un fichier temporaire sûr
      tempFilePath = saveTempAudio(audioBuffer);
    } else {
      tempFilePath = fileOrBase64;
      audioBuffer = fs.readFileSync(tempFilePath);
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Création session Realtime
    const session = await client.realtime.sessions.create({
      model: "gpt-realtime-2025-08-28",
      voice: "alloy"
    });

    // Envoi audio à la session Realtime
    const response = await client.realtime.responses.create({
      session: session.id,
      input: [{
        role: "user",
        content: [{ type: "input_audio", audio: audioBuffer.toString("base64") }]
      }]
    });

    // Récupération de l'audio généré
    let audioBase64 = null;
    for (const out of response.output) {
      for (const item of out.content) {
        if (item.type === "output_audio") audioBase64 = item.audio;
      }
    }

    // Envoi au client Flutter
    if (audioBase64 && sendToFlutter) {
      sendToFlutter({
        index: Date.now(),
        audioBase64,
        deviceId,
        mime: "audio/mpeg"
      }, deviceId);
    }

    return { status: "ok", deviceId };
  } catch (err) {
    console.error(`[assemblyService] Erreur traitement audio pour ${deviceId}:`, err.message);
    return { status: "error", deviceId, message: err.message };
  } finally {
    // Supprime le fichier temporaire
    if (isBase64 && tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}
