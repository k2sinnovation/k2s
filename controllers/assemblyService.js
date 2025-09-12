// assemblyService.js
import OpenAI from "openai";
import fs from "fs";

export async function processAudioAndReturnJSON(fileOrBase64, deviceId, isBase64 = false) {
  const { sendToFlutter } = await import("../websocket.js");

  let audioBuffer;
  if (isBase64) {
    const base64Data = fileOrBase64.includes(",")
      ? fileOrBase64.split(",")[1]
      : fileOrBase64;
    audioBuffer = Buffer.from(base64Data, "base64");
  } else {
    audioBuffer = fs.readFileSync(fileOrBase64);
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const session = await openai.beta.realtime.sessions.create({
    model: "gpt-4o-realtime-preview-2025-06-03",
    voice: "alloy"
  });

  console.log("[Realtime] Session créée :", session.id);

  const response = await openai.beta.realtime.responses.create({
    session: session.id,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            audio: audioBuffer.toString("base64")
          }
        ]
      }
    ]
  });

  console.log("[Realtime] Réponse reçue :", JSON.stringify(response, null, 2));

  let audioBase64 = null;
  for (const output of response.output) {
    for (const item of output.content) {
      if (item.type === "output_audio") {
        audioBase64 = item.audio;
      }
    }
  }

  if (audioBase64) {
    sendToFlutter(
      {
        index: 0,
        text: null,
        audioBase64,
        mime: "audio/mpeg",
        deviceId
      },
      deviceId
    );
  }

  return { status: "ok", deviceId };
}
