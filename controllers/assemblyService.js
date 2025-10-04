const WebSocket = require("ws");

// Stocker les sockets GPT par deviceId pour streaming multiple
const gptSockets = new Map(); // Map<deviceId, WebSocket GPT temps réel>

/**
 * Envoie un chunk audio PCM à GPT et commit si demandé
 * @param {string} deviceId - ID du device Flutter
 * @param {string} audioBase64 - chunk audio PCM Base64
 * @param {object} wsClients - Map<deviceId, WebSocket Flutter>
 * @param {boolean} commit - true si c’est le dernier chunk du segment
 */
async function processAudioChunk(deviceId, audioBase64, wsClients, commit = false) {
  const base64Data = audioBase64.includes(",") ? audioBase64.split(",")[1] : audioBase64;
  const audioBuffer = Buffer.from(base64Data, "base64");

  // Créer socket GPT si n’existe pas
  if (!gptSockets.has(deviceId)) {
    const wsGPT = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2025-06-03",
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    let responseText = "";

    wsGPT.on("open", () => console.log(`[GPT][${deviceId}] Connexion ouverte`));

    wsGPT.on("message", (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } 
      catch (e) { console.warn(`[GPT][${deviceId}] Erreur parsing message:`, e); return; }

      const wsClient = wsClients[deviceId];
      if (!wsClient || wsClient.readyState !== WebSocket.OPEN) return;

      // Texte incrémental
      if (msg.type === "response.output_text.delta") {
        responseText += msg.delta;
        wsClient.send(JSON.stringify({
          deviceId,
          audioPCM: null,
          text: msg.delta,
          index: Date.now(),
        }));
      }

      // Audio PCM incrémental
      if (msg.type === "response.output_audio.delta" || msg.type === "output_audio_buffer.delta") {
        wsClient.send(JSON.stringify({
          deviceId,
          audioPCM: msg.audio, // PCM brut Base64
          text: null,
          index: Date.now(),
        }));
      }

      // Fin de réponse
      if (msg.type === "response.completed") {
        wsClient.send(JSON.stringify({
          deviceId,
          audioPCM: null,
          text: responseText,
          index: Date.now(),
        }));
        wsGPT.close();
        gptSockets.delete(deviceId);
      }

      // Erreurs
      if (msg.type === "error") {
        console.warn(`[GPT][${deviceId}] Erreur:`, msg.error?.message || msg);
      }
    });

    wsGPT.on("close", () => {
      console.log(`[GPT][${deviceId}] Connexion fermée`);
      gptSockets.delete(deviceId);
    });

    wsGPT.on("error", (err) => {
      console.error(`[GPT][${deviceId}] Erreur WebSocket:`, err.message);
      gptSockets.delete(deviceId);
    });

    gptSockets.set(deviceId, wsGPT);
  }

  // Envoyer chunk
  const wsGPT = gptSockets.get(deviceId);
  wsGPT.send(JSON.stringify({
    type: "input_audio_buffer.append",
    audio: audioBuffer.toString("base64"),
  }));

  // Commit + création réponse si c’est le dernier chunk
  if (commit) {
    wsGPT.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    wsGPT.send(JSON.stringify({ type: "response.create", response: { instructions: "Analyse et réponds" } }));
  }
}

module.exports = { processAudioChunk };
