// backend/realtimeFlutterGPT.js
import WebSocket, { WebSocketServer } from 'ws';
import { RealtimeClient } from '@openai/realtime-api-beta';
import dotenv from 'dotenv';
dotenv.config();

const wss = new WebSocketServer({ port: 8080 });
console.log("[Server] WebSocket lancé sur ws://localhost:8080");

wss.on('connection', async (ws) => {
  console.log("[Server] Flutter connecté");

  let deviceId = null;

  const client = new RealtimeClient({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o-realtime-preview-2025-06-03',
    voice: 'alloy',
  });

  await client.connect();
  console.log("[Realtime] Connecté à GPT-4o");

  // Quand GPT envoie de l’audio
  client.on('output_audio_buffer', (chunk) => {
    try {
      const audioBase64 = Buffer.from(chunk).toString('base64');
      if (deviceId) {
        ws.send(JSON.stringify({
          audioBase64,   // 🔹 ton Flutter lit ce champ
          index: Date.now(),
          deviceId
        }));
      }
    } catch (err) {
      console.error("[Server] Erreur envoi audio :", err);
    }
  });

  // Quand Flutter envoie un message
  ws.on('message', async (msg) => {
    try {
      const parsed = JSON.parse(msg);

      if (parsed.deviceId) deviceId = parsed.deviceId;

      if (parsed.audioBase64) {
        const audioBuffer = Buffer.from(parsed.audioBase64, 'base64');
        client.sendAudio(audioBuffer);
      }

      if (parsed.type === 'end') {
        await client.flushAudio();
      }
    } catch (err) {
      console.error("[Server] Erreur parsing message :", err);
    }
  });

  ws.on('close', () => {
    console.log("[Server] Flutter déconnecté");
    client.disconnect();
  });
});
