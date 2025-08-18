// controller/ttsGrpcSocket.js
// WebSocket server pour GPT streaming + Google TTS streaming

const WebSocket = require('ws');
const textToSpeech = require('@google-cloud/text-to-speech');
const client = new textToSpeech.TextToSpeechClient(); // Clé via GOOGLE_APPLICATION_CREDENTIALS
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function startTTSGrpcWebSocketServer(server) {
  const wss = new WebSocket.Server({ server, path: '/tts-grpc-stream' });

  wss.on('connection', (ws) => {
    console.log('[TTS gRPC WS] Nouveau client connecté');

    ws.on('message', async (message) => {
      const text = message.toString();
      console.log('[TTS gRPC WS] Texte complet reçu pour GPT :', text);

      if (!text || text.trim() === '') {
        ws.send(JSON.stringify({ error: 'Texte vide' }));
        ws.close();
        return;
      }

      try {
        // 1️⃣ GPT streaming
        const gptStream = await openai.chat.completions.create({
          model: "gpt-5-mini",
          messages: [
            { role: "system", content: "Réponds de manière concise en français." },
            { role: "user", content: text }
          ],
          stream: true
        });

        gptStream.on('data', async (chunk) => {
          const delta = chunk.choices[0].delta?.content;
          if (delta) {
            console.log('[GPT] Chunk reçu :', delta);

            // 2️⃣ Google TTS streaming pour chaque chunk GPT
            const ttsRequest = {
              input: { text: delta },
              voice: { languageCode: 'fr-FR', name: 'fr-FR-Neural2-F', ssmlGender: 'FEMALE' },
              audioConfig: { audioEncoding: 'MP3' }
            };

            const [ttsStream] = client.streamingSynthesizeSpeech(ttsRequest);

            ttsStream.on('data', (audioChunk) => {
              if (audioChunk.audioContent) {
                ws.send(audioChunk.audioContent.toString('base64'));
              }
            });

            ttsStream.on('error', (err) => {
              console.error('[TTS gRPC WS] Erreur chunk TTS :', err.message);
              ws.send(JSON.stringify({ error: err.message }));
            });
          }
        });

        gptStream.on('end', () => {
          ws.send('END_STREAM');
          console.log('[GPT] Streaming terminé');
          ws.close();
        });

        gptStream.on('error', (err) => {
          console.error('[GPT] Erreur streaming :', err.message);
          ws.send(JSON.stringify({ error: err.message }));
          ws.close();
        });

      } catch (err) {
        console.error('[TTS gRPC WS] Erreur générale :', err.message);
        ws.send(JSON.stringify({ error: err.message }));
        ws.close();
      }
    });

    ws.on('close', () => console.log('[TTS gRPC WS] Client déconnecté'));
    ws.on('error', (err) => console.error('[TTS gRPC WS] Erreur WebSocket :', err.message));
  });

  console.log('[TTS gRPC WS] Serveur WebSocket TTS gRPC initialisé sur /tts-grpc-stream');
}

module.exports = startTTSGrpcWebSocketServer;
