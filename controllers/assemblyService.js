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
    const ws = new WebSocket("wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2025-06-03", {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    });

    let responseAudioBuffers = [];
    let responseText = "";

    ws.on("open", () => {
      console.log(`[assemblyService] WebSocket ouvert pour ${deviceId}`);

      // Envoi audio à GPT Realtime
      ws.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: audioBuffer.toString("base64"),
      }));
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      ws.send(JSON.stringify({ type: "response.create", modalities: ["audio", "text"] }));
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data);

      // Récupération du texte généré
      if (msg.type === "response.output_text.delta") {
        responseText += msg.delta;
      }

      // Récupération de l'audio renvoyé par GPT
      if (msg.type === "output_audio_buffer.delta") {
        responseAudioBuffers.push(Buffer.from(msg.audio, "base64"));
      }

      // Fin de la réponse GPT
      if (msg.type === "response.completed") {
        const fullAudioBuffer = Buffer.concat(responseAudioBuffers);
        const base64Audio = fullAudioBuffer.toString("base64");

        // Envoi vers Flutter
        if (sendToFlutter) {
          sendToFlutter({
            deviceId,
            text: responseText,
            audioBase64: base64Audio,
            index: Date.now(),
          }, deviceId);
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
