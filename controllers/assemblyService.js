const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

/**
 * Sauvegarde temporaire du fichier audio
 */
function saveTempAudio(buffer) {
  if (!fs.existsSync("./uploads")) fs.mkdirSync("./uploads");
  const fileName = `${Date.now()}-${Math.floor(Math.random() * 10000)}.wav`;
  const filePath = path.join("./uploads", fileName);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/**
 * Encapsule un buffer PCM en WAV
 */
function encodeWav(pcmBuffer, sampleRate = 16000) {
  const channels = 1;
  const bitDepth = 16;
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;
  const dataSize = pcmBuffer.length;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitDepth, 34);

  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  pcmBuffer.copy(buffer, 44);
  return buffer;
}

/**
 * Traite l’audio et envoie les réponses chunk par chunk vers le client Flutter
 */
async function processAudioAndReturnJSON(audioBase64, deviceId, wsClients) {
  const base64Data = audioBase64.includes(",") ? audioBase64.split(",")[1] : audioBase64;
  const audioBuffer = Buffer.from(base64Data, "base64");
  const tempFilePath = saveTempAudio(audioBuffer);

  return new Promise((resolve, reject) => {
    const wsGPT = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2025-06-03",
      {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      }
    );

    let responseAudioBuffers = [];
    let responseText = "";

    function log(msg) {
      console.log(`[${new Date().toISOString()}][assemblyService][Device ${deviceId}] ${msg}`);
    }

    wsGPT.on("open", () => {
      log("WebSocket GPT ouvert");

      // 1️⃣ Envoi audio d’entrée
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
      try {
        msg = JSON.parse(data);
      } catch (e) {
        log(`Erreur parsing message GPT: ${e}`);
        return;
      }

      // 🔹 Log
      log(`Message GPT reçu: ${msg.type}`);

      // Texte reçu
      if (msg.type === "response.output_text.delta") {
        responseText += msg.delta;
      }

      // Chunk audio reçu → envoi immédiat à Flutter
      if (msg.type === "output_audio_buffer.delta") {
        const chunkBuffer = Buffer.from(msg.audio, "base64");
        responseAudioBuffers.push(chunkBuffer);

        const wsClient = wsClients[deviceId];
        if (wsClient && wsClient.readyState === WebSocket.OPEN) {
          wsClient.send(JSON.stringify({
            deviceId,
            audioBase64: chunkBuffer.toString("base64"),
            text: null,
            index: Date.now(),
          }));
        }
      }

      // Fin de réponse → envoyer texte final + audio complet
      if (msg.type === "response.completed") {
        const fullAudioBuffer = Buffer.concat(responseAudioBuffers);
        const wavBuffer = encodeWav(fullAudioBuffer, 16000);

        const wsClient = wsClients[deviceId];
        if (wsClient && wsClient.readyState === WebSocket.OPEN) {
          wsClient.send(JSON.stringify({
            deviceId,
            audioBase64: wavBuffer.toString("base64"),
            text: responseText,
            index: Date.now(),
          }));
        }

        wsGPT.close();
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        resolve({ status: "ok", deviceId, text: responseText, audioBase64: wavBuffer.toString("base64") });
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
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      log("WebSocket GPT fermé et fichier temporaire supprimé");
    });
  });
}

module.exports = { processAudioAndReturnJSON };
