// backend/realtimeFlutterGPT.js
import WebSocket, { WebSocketServer } from 'ws';
import { RealtimeClient } from '@openai/realtime-api-beta';
import dotenv from 'dotenv';
dotenv.config();

console.log("[Server] Démarrage serveur Realtime GPT-4o pour Flutter");

// ------------------------
// WebSocket
// ------------------------
const wss = new WebSocketServer({ port: 8080 });
console.log("[Server] WebSocket lancé sur ws://localhost:8080");

// ------------------------
// Quand Flutter se connecte
// ------------------------
wss.on('connection', async (ws) => {
  console.log("[Server] Flutter connecté");

  let deviceId = null;

  // Création du client Realtime GPT-4o
  const client = new RealtimeClient({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o-realtime-preview-2025-06-03',
    voice: 'alloy', // Voix synthétique par défaut
  });

  await client.connect();
  console.log("[Realtime] Connecté à GPT-4o-realtime");

  // ------------------------
  // Réception audio de GPT → envoi à Flutter
  // ------------------------
  client.on('output_audio_buffer', (chunk) => {
    try {
      const audioBase64 = Buffer.from(chunk).toString('base64');
      if (deviceId) {
        ws.send(JSON.stringify({
          type: 'audio',
          deviceId,
          audioBase64
        }));
      }
    } catch (err) {
      console.error("[Server] Erreur envoi audio à Flutter :", err);
    }
  });

  // ------------------------
  // Réception messages de Flutter
  // ------------------------
  ws.on('message', async (msg) => {
    try {
      const { type, data, deviceId: incomingId } = JSON.parse(msg);

      if (incomingId) deviceId = incomingId; // Stocke l'ID de l'appareil Flutter

      if (type === 'audio') {
        const audioBuffer = Buffer.from(data, 'base64');
        client.sendAudio(audioBuffer); // Envoie directement à GPT
      }

      if (type === 'end') {
        await client.flushAudio(); // Signale fin d'entrée vocale
      }
    } catch (err) {
      console.error("[Server] Erreur traitement message :", err);
    }
  });

  ws.on('close', () => {
    console.log("[Server] Flutter déconnecté");
    client.disconnect();
  });
});

console.log("[Server] Serveur prêt à recevoir l'audio Flutter");
