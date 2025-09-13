// controllers/assemblyService.js
import fs from "fs";
import OpenAI from "openai";

/**
 * Traite l'audio envoyé par Flutter et renvoie l'audio généré par GPT-Realtime.
 *
 * @param {string|Buffer} fileOrBase64 - Chemin du fichier ou Base64 audio
 * @param {string} deviceId - ID du device Flutter
 * @param {function} sendToFlutter - fonction callback pour renvoyer l'audio
 * @param {boolean} isBase64 - true si fileOrBase64 est déjà un base64
 */
export async function processAudioAndReturnJSON(fileOrBase64, deviceId, sendToFlutter, isBase64 = false) {
  let audioBuffer;

  if (isBase64) {
    const base64Data = fileOrBase64.includes(",") ? fileOrBase64.split(",")[1] : fileOrBase64;
    audioBuffer = Buffer.from(base64Data, "base64");
  } else {
    audioBuffer = fs.readFileSync(fileOrBase64);
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Créer une session Realtime avec GPT-Realtime 2025-08-28
  const session = await client.realtime.sessions.create({
    model: "gpt-realtime-2025-08-28",
    voice: "alloy"
  });

  // Envoyer l’audio et récupérer la réponse
  const response = await client.realtime.responses.create({
    session: session.id,
    input: [{
      role: "user",
      content: [{
        type: "input_audio",
        audio: audioBuffer.toString("base64")
      }]
    }]
  });

  // Récupérer l’audio généré
  let audioBase64 = null;
  for (const out of response.output) {
    for (const item of out.content) {
      if (item.type === "output_audio") {
        audioBase64 = item.audio;
      }
    }
  }

  // Envoyer au Flutter via la fonction passée en paramètre
  if (audioBase64 && sendToFlutter) {
    sendToFlutter({
      index: Date.now(),
      audioBase64,
      deviceId,
      mime: "audio/mpeg"
    }, deviceId);
  }

  return { status: "ok", deviceId };
}
