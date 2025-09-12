import { RealtimeClient } from "openai/realtime";
import fs from "fs";

// ------------------------
// Fonction principale
// ------------------------
export async function processAudioRealtime(fileOrBase64, deviceId, isBase64 = false) {
  const { sendToFlutter } = await import("../websocket.js");

  // Préparer l’audio en buffer
  let audioBuffer;
  if (isBase64) {
    const base64Data = fileOrBase64.includes(",")
      ? fileOrBase64.split(",")[1]
      : fileOrBase64;
    audioBuffer = Buffer.from(base64Data, "base64");
  } else {
    audioBuffer = fs.readFileSync(fileOrBase64);
  }

  // Créer un client Realtime
  const client = new RealtimeClient({
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-4o-realtime-preview-2025-06-03",
    voice: "alloy" // tu peux changer la voix
  });

  // Connexion
  await client.connect();

  console.log("[Realtime] Connecté à GPT-4o-realtime");

  // Écoute des chunks audio en sortie
  client.on("output_audio_buffer", (chunk) => {
    const audioBase64 = chunk.toString("base64");
    sendToFlutter({
      index: 0,
      text: null,
      audioBase64,
      mime: "audio/mpeg",
      deviceId
    }, deviceId);
  });

  // Envoyer l’audio utilisateur
  await client.sendAudio(audioBuffer);

  console.log("[Realtime] Audio envoyé au modèle");

  // Clore après la réponse
  client.on("session_ended", () => {
    console.log("[Realtime] Session terminée");
    client.disconnect();
  });

  return { status: "ok", deviceId };
}
