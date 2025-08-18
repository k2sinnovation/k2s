// controller/ttsSocket.js
// WebSocket server pour Google TTS streaming
// Adapté pour Render : clé API dans les variables d'environnement

const WebSocket = require('ws');
const axios = require('axios');

// Fonction principale pour initialiser le serveur WebSocket
async function startTTSWebSocketServer(server) {
  // Serveur WebSocket attaché au serveur HTTP existant
  const wss = new WebSocket.Server({ server, path: '/tts-stream' });

  wss.on('connection', (ws) => {
    console.log('[TTS WS] Nouveau client connecté');

    // Quand le client envoie un message (texte à vocaliser)
    ws.on('message', async (message) => {
      const text = message.toString();
      console.log('[TTS WS] Texte reçu :', text);

      if (!text || text.trim() === '') {
        ws.send(JSON.stringify({ error: 'Texte vide' }));
        ws.close();
        return;
      }

      try {
        // Appel Google TTS via REST
        const apiKey = process.env.K2S_IQ_Speech_API;
        console.log('[TTS WS] Envoi du texte à Google TTS...');

        const response = await axios.post(
          `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
          {
            input: { text },
            voice: {
              languageCode: 'fr-FR',
              name: 'fr-FR-Chirp3-HD-Leda', // voix naturelle féminine
              ssmlGender: 'FEMALE',
            },
            audioConfig: { audioEncoding: 'MP3' },
          },
          { responseType: 'json' }
        );

        if (!response.data || !response.data.audioContent) {
          ws.send(JSON.stringify({ error: 'Aucune audioContent reçue de Google TTS' }));
          ws.close();
          return;
        }

        console.log('[TTS WS] Audio reçu de Google TTS. Taille Base64 :', response.data.audioContent.length);

        // Streaming simple : découpe Base64 en petits chunks
        const base64 = response.data.audioContent;
        const chunkSize = 1024; // 1 Ko par chunk
        for (let i = 0; i < base64.length; i += chunkSize) {
          const chunk = base64.slice(i, i + chunkSize);
          ws.send(chunk);
        }

        // Signal de fin de stream
        ws.send('END_STREAM');
        console.log('[TTS WS] Streaming terminé');
        ws.close();

      } catch (err) {
        console.error('[TTS WS] Erreur Google TTS :', err.message);
        ws.send(JSON.stringify({ error: err.message }));
        ws.close();
      }
    });

    ws.on('close', () => {
      console.log('[TTS WS] Client déconnecté');
    });

    ws.on('error', (err) => {
      console.error('[TTS WS] Erreur WebSocket :', err.message);
    });
  });

  console.log('[TTS WS] Serveur WebSocket TTS initialisé sur /tts-stream');
}

module.exports = startTTSWebSocketServer;
