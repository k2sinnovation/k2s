// controller/ttsGrpcSocket.js
// WebSocket server pour Google TTS streaming via gRPC
// Nécessite : @google-cloud/text-to-speech

const WebSocket = require('ws');
const textToSpeech = require('@google-cloud/text-to-speech');
const client = new textToSpeech.TextToSpeechClient(); // Clé via GOOGLE_APPLICATION_CREDENTIALS

async function startTTSGrpcWebSocketServer(server) {
  const wss = new WebSocket.Server({ server, path: '/tts-grpc-stream' });

  wss.on('connection', (ws) => {
    console.log('[TTS gRPC WS] Nouveau client connecté');

    ws.on('message', async (message) => {
      const text = message.toString();
      console.log('[TTS gRPC WS] Texte reçu :', text);

      if (!text || text.trim() === '') {
        ws.send(JSON.stringify({ error: 'Texte vide' }));
        ws.close();
        return;
      }

      try {
        const request = {
          input: { text },
          voice: { languageCode: 'fr-FR', name: 'fr-FR-Neural2-F', ssmlGender: 'FEMALE' },
          audioConfig: { audioEncoding: 'MP3' },
        };

        console.log('[TTS gRPC WS] Démarrage du streaming Google TTS...');

        // streamingSynthesizeSpeech renvoie un flux audio
        const [stream] = client.streamingSynthesizeSpeech(request);

        stream.on('data', (chunk) => {
          if (chunk.audioContent) {
            // Convertir en Base64 et envoyer
            ws.send(chunk.audioContent.toString('base64'));
          }
        });

        stream.on('end', () => {
          ws.send('END_STREAM');
          console.log('[TTS gRPC WS] Streaming terminé');
          ws.close();
        });

        stream.on('error', (err) => {
          console.error('[TTS gRPC WS] Erreur streaming :', err.message);
          ws.send(JSON.stringify({ error: err.message }));
          ws.close();
        });

      } catch (err) {
        console.error('[TTS gRPC WS] Erreur Google TTS :', err.message);
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
