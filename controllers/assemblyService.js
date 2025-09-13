import fs from "fs";
import path from "path";
import OpenAI from "openai";

export async function processAudioAndReturnJSON(fileOrBase64, deviceId, sendToFlutter, isBase64 = false) {
  let audioBuffer;

  if (isBase64) {
    const base64Data = fileOrBase64.includes(",") ? fileOrBase64.split(",")[1] : fileOrBase64;
    audioBuffer = Buffer.from(base64Data, "base64");

    // 🔹 Créer un fichier temporaire sûr
    const tempFileName = `${Date.now()}-${Math.floor(Math.random()*10000)}.wav`;
    const tempFilePath = path.join("./uploads", tempFileName);
    fs.writeFileSync(tempFilePath, audioBuffer);
    fileOrBase64 = tempFilePath; // mettre à jour fileOrBase64 pour la lecture si nécessaire
  } else {
    audioBuffer = fs.readFileSync(fileOrBase64);
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const session = await client.realtime.sessions.create({
    model: "gpt-realtime-2025-08-28",
    voice: "alloy"
  });

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

  let audioBase64 = null;
  for (const out of response.output) {
    for (const item of out.content) {
      if (item.type === "output_audio") audioBase64 = item.audio;
    }
  }

  if (audioBase64 && sendToFlutter) {
    sendToFlutter({
      index: Date.now(),
      audioBase64,
      deviceId,
      mime: "audio/mpeg"
    }, deviceId);
  }

  // 🔹 Supprimer le fichier temporaire après traitement
  if (isBase64) fs.unlinkSync(fileOrBase64);

  return { status: "ok", deviceId };
}
