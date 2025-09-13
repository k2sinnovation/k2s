import OpenAI from "openai";
import fs from "fs";

export async function processAudioAndReturnJSON(fileOrBase64, deviceId, isBase64 = false) {
  const { sendToFlutter } = await import("../websocket.js");

  let audioBuffer;
  if (isBase64) {
    const base64Data = fileOrBase64.includes(",") ? fileOrBase64.split(",")[1] : fileOrBase64;
    audioBuffer = Buffer.from(base64Data, "base64");
  } else {
    audioBuffer = fs.readFileSync(fileOrBase64);
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // 🔹 Realtime via WebSocket
  const session = await openai.realtime.connect({
    model: "gpt-4o-realtime-preview-2025-06-03",
    voice: "alloy"
  });

  // Envoyer l’audio du client
  const response = await session.sendAudio(audioBuffer);

  // Recevoir l’audio généré
  let audioBase64 = response.outputAudio; // le Base64 reçu du modèle

  // Envoyer au Flutter
  sendToFlutter({
    index: Date.now(),
    audioBase64,
    deviceId,
    mime: "audio/mpeg"
  }, deviceId);

  return { status: "ok", deviceId };
}

