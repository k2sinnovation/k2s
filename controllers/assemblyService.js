import fs from "fs";
import path from "path";
import OpenAI from "openai";

/**
 * Crée un fichier temporaire sûr pour l'audio
 */
function saveTempAudio(audioBuffer) {
  const uploadDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

  const tempFileName = `${Date.now()}-${Math.floor(Math.random() * 10000)}.wav`;
  const tempFilePath = path.join(uploadDir, tempFileName);

  fs.writeFileSync(tempFilePath, audioBuffer);
  return tempFilePath;
}

/**
 * Traite l'audio et renvoie le résultat au client Flutter
 */
export async function processAudioAndReturnJSON(fileOrBase64, deviceId, sendToFlutter, isBase64 = true) {
  let audioBuffer;
  let tempFilePath = null;

  try {
    // 🔹 Vérification automatique Base64
    const looksLikeBase64 = typeof fileOrBase64 === "string" && fileOrBase64.length > 1000 && /^[A-Za-z0-9+/=,\r\n]+$/.test(fileOrBase64);

    if (isBase64 || looksLikeBase64) {
      // On prend la partie après la virgule si data URL
      const base64Data = fileOrBase64.includes(",") ? fileOrBase64.split(",")[1] : fileOrBase64;
      audioBuffer = Buffer.from(base64Data, "base64");

      // 🔹 Nom de fichier sûr
      tempFilePath = saveTempAudio(audioBuffer);
    } else {
      // Chemin de fichier local
      tempFilePath = fileOrBase64;
      audioBuffer = fs.readFileSync(tempFilePath);
    }

    // 🔹 Crée le client OpenAI
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // 🔹 Crée une session Realtime
    const session = await client.realtime.sessions.create({
      model: "gpt-realtime-2025-08-28",
      voice: "alloy"
    });

    // 🔹 Envoi audio à GPT
    const response = await client.realtime.responses.create({
      session: session.id,
      input: [{
        role: "user",
        content: [{ type: "input_audio", audio: audioBuffer.toString("base64") }]
      }]
    });

    // 🔹 Récupération audio généré
    let audioBase64 = null;
    for (const out of response.output || []) {
      for (const item of out.content || []) {
        if (item.type === "output_audio") audioBase64 = item.audio;
      }
    }

    // 🔹 Envoi au client Flutter
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
    // 🔹 Suppression du fichier temporaire
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}
