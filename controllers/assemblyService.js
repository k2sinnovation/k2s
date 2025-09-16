// audioService.js
import fs from "fs";
import path from "path";
import OpenAI from "openai";

// Stockage temporaire de sessions par deviceId
const sessions = {};

/**
 * Crée un fichier temporaire pour l'audio
 */
function saveTempAudio(buffer) {
  const dir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const filePath = path.join(dir, `${Date.now()}-${Math.floor(Math.random() * 10000)}.wav`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/**
 * Initialise ou récupère la session OpenAI pour un device
 */
async function getOrCreateSession(deviceId) {
  if (!sessions[deviceId]) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const session = await client.realtime.sessions.create({
      model: "gpt-realtime-2025-08-28",
      voice: "alloy",
    });
    sessions[deviceId] = { client, session };
  }
  return sessions[deviceId];
}

/**
 * Traite l'audio et renvoie le résultat au client Flutter
 */
export async function processAudio(fileOrBase64, deviceId, sendToFlutter, isBase64 = true) {
  let audioBuffer;
  let tempFile = null;

  try {
    // 🔹 Vérification Base64
    const looksLikeBase64 =
      typeof fileOrBase64 === "string" && fileOrBase64.length > 1000 && /^[A-Za-z0-9+/=,\r\n]+$/.test(fileOrBase64);

    if (isBase64 || looksLikeBase64) {
      const base64Data = fileOrBase64.includes(",") ? fileOrBase64.split(",")[1] : fileOrBase64;
      audioBuffer = Buffer.from(base64Data, "base64");
      tempFile = saveTempAudio(audioBuffer);
    } else {
      tempFile = fileOrBase64;
      audioBuffer = fs.readFileSync(tempFile);
    }

    // 🔹 Récupération session OpenAI
    const { client, session } = await getOrCreateSession(deviceId);

    // 🔹 Envoi audio à GPT
    const response = await client.realtime.responses.create({
      session: session.id,
      input: [
        {
          role: "user",
          content: [{ type: "input_audio", audio: audioBuffer.toString("base64") }],
        },
      ],
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
      sendToFlutter(
        {
          index: Date.now(),
          audioBase64,
          deviceId,
          mime: "audio/mpeg",
        },
        deviceId
      );
    }

    return { status: "ok", deviceId };
  } catch (err) {
    console.error(`[audioService] Erreur pour ${deviceId}:`, err.message);
    return { status: "error", deviceId, message: err.message };
  } finally {
    // 🔹 Supprime le fichier temporaire
    if (tempFile && fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
}
