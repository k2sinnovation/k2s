// controller/ttsGrpcSocketBuffered.js
const WebSocket = require('ws');
const textToSpeech = require('@google-cloud/text-to-speech');
const client = new textToSpeech.TextToSpeechClient();
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function startTTSGrpcBufferedServer(server) {
  const wss = new WebSocket.Server({ server, path: '/tts-grpc-stream' });

  wss.on('connection', (ws) => {
    console.log('[TTS WS] Client connecté');

    ws.on('message', async (message) => {
      const text = message.toString();
      if (!text.trim()) {
        ws.send(JSON.stringify({ error: 'Texte vide' }));
        return ws.close();
      }

      try {
        let buffer = '';
        let timeoutId = null;
        const BUFFER_SIZE = 500; // nombre de caractères avant envoi
        const BUFFER_DELAY = 300; // délai max en ms

        const flushBuffer = async () => {
          if (!buffer) return;
          const ttsRequest = {
            input: { text: buffer },
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
            console.error('[TTS WS] Erreur chunk TTS :', err.message);
            ws.send(JSON.stringify({ error: err.message }));
          });

          buffer = '';
        };

        // GPT streaming
        const gptStream = await openai.chat.completions.create({
          model: "gpt-5-mini",
          messages: [
            { role: "system", content: "Réponds de manière concise en français." },
            { role: "user", content: text }
          ],
          stream: true
        });

        gptStream.on('data', (chunk) => {
          const delta = chunk.choices[0].delta?.content;
          if (!delta) return;

          buffer += delta;

          if (buffer.length >= BUFFER_SIZE) {
            clearTimeout(timeoutId);
            flushBuffer();
          } else {
            // flush après un délai pour ne pas attendre trop longtemps
            clearTimeout(timeoutId);
            timeoutId = setTimeout(flushBuffer, BUFFER_DELAY);
          }
        });

        gptStream.on('end', async () => {
          clearTimeout(timeoutId);
          await flushBuffer(); // envoyer le reste du buffer
          ws.send('END_STREAM');
          ws.close();
        });

        gptStream.on('error', (err) => {
          console.error('[GPT WS] Erreur streaming :', err.message);
          ws.send(JSON.stringify({ error: err.message }));
          ws.close();
        });

      } catch (err) {
        console.error('[TTS WS] Erreur générale :', err.message);
        ws.send(JSON.stringify({ error: err.message }));
        ws.close();
      }
    });

    ws.on('close', () => console.log('[TTS WS] Client déconnecté'));
    ws.on('error', (err) => console.error('[TTS WS] Erreur WebSocket :', err.message));
  });

  console.log('[TTS WS] Serveur WebSocket initialisé sur /tts-grpc-stream');
}

module.exports = startTTSGrpcBufferedServer;
