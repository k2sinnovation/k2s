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
function encodeWav(pcmBuffer, sampleRate = 24000) {
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
 * Envoie un audio à GPT Realtime et renvoie la réponse audio + texte à Flutter
 * @param {string} audioBase64 Audio en base64 depuis Flutter
 * @param {string} deviceId Device ciblé
 * @param {function} sendToFlutter La vraie fonction d'envoi WebSocket
 */
async function processAudioAndReturnJSON(audioBase64, deviceId, sendToFlutter) {
  const base64Data = audioBase64.includes(",") ? audioBase64.split(",")[1] : audioBase64;
  const audioBuffer = Buffer.from(base64Data, "base64");

  // Sauvegarde temporaire
  const tempFilePath = saveTempAudio(audioBuffer);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2025-06-03",
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    let responseAudioBuffers = [];
    let responseText = "";

    ws.on("open", () => {
      console.log(`[assemblyService] WebSocket ouvert pour ${deviceId}`);

      // Envoi audio à GPT Realtime
      ws.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: audioBuffer.toString("base64"),
        })
      );
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      ws.send(JSON.stringify({ type: "response.create", modalities: ["audio", "text"] }));
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data);

      // Log pour debug
      console.log(`[assemblyService] Message GPT reçu: ${msg.type}`);

      // Récupération du texte généré
      if (msg.type === "response.output_text.delta") {
        responseText += msg.delta;
      }

      // Récupération de l'audio renvoyé par GPT
      if (msg.type === "output_audio_buffer.delta") {
        console.log(`[assemblyService] Chunk audio reçu de GPT, taille base64: ${msg.audio.length}`);
        responseAudioBuffers.push(Buffer.from(msg.audio, "base64"));
      }

      // Fin de la réponse GPT
      if (msg.type === "response.completed") {
        const fullAudioBuffer = Buffer.concat(responseAudioBuffers);

        // Convertir PCM en WAV pour Flutter
        const wavBuffer = encodeWav(fullAudioBuffer, 24000);
        const base64Audio = wavBuffer.toString("base64");

        // Envoi vers Flutter
        if (sendToFlutter) {
          sendToFlutter(
            {
              deviceId,
              text: responseText,
              audioBase64: base64Audio,
              index: Date.now(),
            },
            deviceId
          );
        }

        ws.close();
        resolve({
          status: "ok",
          deviceId,
          text: responseText,
          audioBase64: base64Audio,
        });
      }
    });

    ws.on("error", (err) => {
      console.error(`[assemblyService] Erreur WebSocket pour ${deviceId}:`, err.message);
      reject({ status: "error", deviceId, message: err.message });
    });

    ws.on("close", () => {
      // Supprime le fichier temporaire
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    });
  });
}

module.exports = { processAudioAndReturnJSON };
