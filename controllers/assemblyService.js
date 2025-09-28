const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

/**
 * Traite l’audio et envoie les réponses chunk par chunk vers le client Flutter
 * ⚡ Streaming PCM temps réel
 */
async function processAudioAndReturnJSON(audioBase64, deviceId, wsClients) {
  const base64Data = audioBase64.includes(",") ? audioBase64.split(",")[1] : audioBase64;
  const audioBuffer = Buffer.from(base64Data, "base64");

  return new Promise((resolve, reject) => {
    const wsGPT = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2025-06-03",
      {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      }
    );

    let responseText = "";

    function log(msg) {
      console.log(`[${new Date().toISOString()}][Device ${deviceId}] ${msg}`);
    }

    wsGPT.on("open", () => {
      log("WebSocket GPT ouvert");

      // 1️⃣ Envoi audio d’entrée (PCM Base64)
      wsGPT.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: audioBuffer.toString("base64"),
      }));
      wsGPT.send(JSON.stringify({ type: "input_audio_buffer.commit" }));

      // 2️⃣ Demande de réponse
      wsGPT.send(JSON.stringify({
        type: "response.create",
        response: { instructions: "Analyse et réponds" },
      }));
    });

    wsGPT.on("message", (data) => {
      let msg;
      try { msg = JSON.parse(data); } 
      catch (e) { log(`Erreur parsing message GPT: ${e}`); return; }

      log(`Message GPT reçu: ${msg.type}`);

      // Texte reçu
      if (msg.type === "response.output_text.delta") {
        responseText += msg.delta;
      }

      // Chunk audio reçu → envoi immédiat à Flutter en PCM Base64
      if (msg.type === "output_audio_buffer.delta") {
        const chunkBuffer = Buffer.from(msg.audio, "base64");
        const wsClient = wsClients[deviceId];
        if (wsClient && wsClient.readyState === WebSocket.OPEN) {
          wsClient.send(JSON.stringify({
            deviceId,
            audioPCM: chunkBuffer.toString("base64"), // ⚡ PCM brut
            text: null,
            index: Date.now(),
          }));
        }
      }

      // Fin de réponse → envoyer texte final
      if (msg.type === "response.completed") {
        const wsClient = wsClients[deviceId];
        if (wsClient && wsClient.readyState === WebSocket.OPEN) {
          wsClient.send(JSON.stringify({
            deviceId,
            audioPCM: null, // fin du flux audio
            text: responseText,
            index: Date.now(),
          }));
        }
        wsGPT.close();
        resolve({ status: "ok", deviceId, text: responseText });
      }

      if (msg.type === "error") {
        log(`⚠️ Erreur GPT: ${JSON.stringify(msg)}`);
      }
    });

    wsGPT.on("error", (err) => {
      log(`Erreur WebSocket GPT: ${err.message}`);
      reject({ status: "error", deviceId, message: err.message });
    });

    wsGPT.on("close", () => {
      log("WebSocket GPT fermé");
    });
  });
}

module.exports = { processAudioAndReturnJSON };
