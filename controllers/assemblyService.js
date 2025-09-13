import OpenAI from "openai";
import fs from "fs";

export async function processAudioAndReturnJSON(fileOrBase64, deviceId, isBase64 = false) {
  const { sendToFlutter } = await import("../websocket.js");

  let tempFilePath;
  if (isBase64) {
    const base64Data = fileOrBase64.includes(",") ? fileOrBase64.split(",")[1] : fileOrBase64;
    const audioBuffer = Buffer.from(base64Data, "base64");
    tempFilePath = `./uploads/${Date.now()}.wav`;
    fs.writeFileSync(tempFilePath, audioBuffer);
  } else {
    tempFilePath = fileOrBase64;
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Transcription classique
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(tempFilePath),
    model: "gpt-4o-transcribe"
  });

  // Optionnel : envoyer la transcription au client Flutter
  sendToFlutter({ text: transcription.text, deviceId }, deviceId);

  return { status: "ok", deviceId, transcription: transcription.text };
}
