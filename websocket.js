const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const assemblyService = require('./controllers/assemblyService');
const { buildFirstAnalysisPrompt, buildSecondAnalysisPrompt } = require('./utils/promptBuilder');

const clients = new Map(); // Map<deviceId, { ws }>

// Utils pour parsing JSON IA
function normalizeJsonString(jsonStr) {
  return jsonStr
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00A0/g, ' ')
    .trim();
}

function extractJsonSafely(content) {
  try {
    const cleaned = normalizeJsonString(content);
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Aucun JSON trouvé");
    const json = JSON.parse(match[0]);
    return {
      resume: json.resume || "",
      questions: Array.isArray(json.questions) ? json.questions : [],
      causes: Array.isArray(json.causes) ? json.causes : [],
      result: json.result || json.diagnostic || "",
      diagnostic: json.diagnostic || json.result || "",
      message: json.message || ""
    };
  } catch (err) {
    console.error("[WS] Erreur parsing JSON IA :", err, "\nTexte brut :", content);
    return { resume: "", questions: [], causes: [], result: "", diagnostic: "", message: "Erreur parsing JSON IA" };
  }
}

// Lire les citations
let quotes = [];
try {
  const raw = fs.readFileSync(path.join(__dirname, 'utils', 'citation'), 'utf8');
  quotes = JSON.parse(raw);
} catch (e) {
  console.warn('[WebSocket] Impossible de charger les citations :', e.message);
  quotes = [];
}

// Ping régulier pour garder la connexion
function startPing() {
  setInterval(() => {
    clients.forEach(({ ws }, deviceId) => {
      if (ws.readyState === WebSocket.OPEN) ws.ping('keepalive');
    });
  }, 15000);
}
startPing();

// Envoie un message au device ciblé
function sendToFlutter(payload, targetDeviceId) {
  if (!targetDeviceId) return false;
  const client = clients.get(String(targetDeviceId));
  if (!client || client.ws.readyState !== WebSocket.OPEN) return false;

  try {
    client.ws.send(JSON.stringify(payload));
    console.log(`[WS] Message envoyé à ${targetDeviceId}: type=${payload.type}`);
    return true;
  } catch (e) {
    console.warn('[WebSocket] Échec envoi à', targetDeviceId, e.message);
    return false;
  }
}

// Attacher WS au serveur HTTP
function attachWebSocketToServer(server, openai) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.serverOpenAI = openai;
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    let deviceId = null;
    console.log('[WS] Nouveau client connecté');

    // Interval pour citations
    const citationInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN && deviceId && quotes.length > 0) {
        const randomIndex = Math.floor(Math.random() * quotes.length);
        sendToFlutter({ type: 'quote', quote: quotes[randomIndex].quote }, deviceId);
      }
    }, 15000);

    ws.on('message', async (rawMessage) => {
      let data;
      try {
        data = JSON.parse(rawMessage);
      } catch (err) {
        console.error('[WS] JSON invalide', err.message);
        return;
      }

      // Définir deviceId si pas encore
      if (!deviceId && data.deviceId) {
        deviceId = String(data.deviceId);
        clients.set(deviceId, { ws });
        console.log('[WS] Device connecté :', deviceId);
      }

      if (!deviceId) {
        console.warn('[WS] deviceId manquant, message ignoré');
        return;
      }

      // Gestion audio
      if (data.audioBase64) {
        try {
          await assemblyService.processAudioAndReturnJSON(data.audioBase64, deviceId, true);
        } catch (err) {
          console.error('[WS] Erreur traitement audio :', err.message);
          sendToFlutter({ type: 'audio_error', deviceId, message: err.message }, deviceId);
        }
      }

      // Gestion GPT
      if (data.type && ws.serverOpenAI) {
        let prompt, typeResponse;
        const userText = data.text || data.userInput || "";

        switch (data.type) {
          case 'questions_request':
            const qaQ = data.previousQA?.length
              ? data.previousQA.map((item, idx) => `Q${idx+1}: ${item.question}\nR: ${item.reponse}`).join('\n\n')
              : "Aucune question précédente.";
            prompt = buildFirstAnalysisPrompt(userText, qaQ);
            typeResponse = 'questions_response';
            break;

          case 'analyze_request':
            const qaA = data.previousQA?.length
              ? data.previousQA.map((item, idx) => `Q${idx+1}: ${item.question}\nR: ${item.reponse}`).join('\n\n')
              : "Aucune question précédente.";
            prompt = buildFirstAnalysisPrompt(userText, qaA);
            typeResponse = 'analyze_response';
            break;

          case 'answer_request':
            prompt = buildSecondAnalysisPrompt(
              data.resume || '',
              data.previousQA || [],
              data.diagnostic_precedent || '',
              data.analyseIndex || 1
            );
            typeResponse = 'answer_response';
            break;

          case 'final_analysis_request':
            prompt = buildSecondAnalysisPrompt(
              data.resume || '',
              [],
              '',
              data.analyseIndex || 1
            );
            typeResponse = 'final_analysis_response';
            break;

          default:
            console.warn('[WS] Type inconnu :', data.type);
            return;
        }

        try {
          const completion = await ws.serverOpenAI.chat.completions.create({
            model: "gpt-4o-search-preview-2025-03-11",
            messages: [{ role: "user", content: prompt }],
          });

          const resultText = completion.choices[0].message.content;
          const resultJSON = extractJsonSafely(resultText);
          if (data.analyseIndex !== undefined) resultJSON.analyseIndex = data.analyseIndex;

          sendToFlutter({ type: typeResponse, deviceId, ...resultJSON }, deviceId);
        } catch (err) {
          console.error('[WS] Erreur GPT :', err);
          sendToFlutter({ type: typeResponse, deviceId, message: 'Erreur GPT' }, deviceId);
        }
      }
    });

    ws.on('close', () => {
      clearInterval(citationInterval);
      if (deviceId) {
        clients.delete(deviceId);
        console.log('[WS] Device déconnecté :', deviceId);
      }
    });

    ws.on('pong', (data) => {
      console.log(`[WS] Pong reçu de device ${deviceId || 'inconnu'} :`, data.toString());
    });
  });

  console.log('[WS] WebSocket server prêt !');
}

module.exports = { attachWebSocketToServer, clients, sendToFlutter };
