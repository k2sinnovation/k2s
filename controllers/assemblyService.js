// assemblyService.js
import WebSocket from "ws";
import { sendToFlutter } from "../websocket.js";

/**
 * Traite l'audio envoyé par Flutter et renvoie l'audio généré par GPT-4o Realtime.
 *
 * @param {string|Buffer} fileOrBase64 - Chemin du fichier ou base64 audio
 * @param {string} deviceId - ID du device Flutter
 * @param {boolean} isBase64 - true si fileOrBase64 est déjà un base64
 */
export async function processAudioAndReturnJSON(fileOrBase64, deviceId, isBase64 = false) {
  let audioBuffer;

  if (isBase64) {
    const base64Data = fileOrBase64.includes(",") ? fileOrBase64.split(",")[1] : fileOrBase64;
    audioBuffer = Buffer.from(base64Data, "base64");
  } else {
    // lecture d'un fichier local
    const fs = await import("fs");
    audioBuffer = fs.readFileSync(fileOrBase64);
  }

  // 🔹 WebSocket vers GPT-4o Realtime
  const ws = new WebSocket("wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2025-06-03", {
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1"
    }
  });

  return new Promise((resolve, reject) => {
    ws.on("open", () => {
      console.log("[Realtime] Connexion établie avec OpenAI Realtime");

      // Envoyer l'audio reçu du client Flutter
      ws.send(JSON.stringify({
        type: "input_audio",
        audio: audioBuffer.toString("base64")
      }));
    });

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());

        // On récupère uniquement l'audio généré
        if (message.type === "output_audio" && message.audio) {
          const audioBase64 = message.audio;

          // 🔹 Envoi au Flutter
          sendToFlutter({
            index: Date.now(),
            audioBase64,
            deviceId,
            mime: "audio/mpeg"
          }, deviceId);

          // Fermer le WS après réception
          ws.close();

          resolve({ status: "ok", deviceId });
        }
      } catch (err) {
        console.error("[Realtime] Erreur parsing message :", err.message);
      }
    });

    ws.on("error", (err) => {
      console.error("[Realtime] WebSocket Error :", err.message);
      reject(err);
    });

    ws.on("close", () => {
      console.log("[Realtime] WebSocket fermé");
    });
  });
}
