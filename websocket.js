const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const assemblyService = require('./controllers/assemblyService');
const { buildFirstAnalysisPrompt, buildSecondAnalysisPrompt } = require('./utils/promptBuilder'); // ✅ ajout

// ✅ Utils pour parsing JSON IA
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

const clients = new Map(); // Map<deviceId, { ws }>

// WS server
const wss = new WebSocket.Server({ noServer: true });

// Lire les citations
let quotes = []; 
try {
  const raw = fs.readFileSync(path.join(__dirname, 'utils', 'citation'), 'utf8');
  quotes = JSON.parse(raw);
} catch (e) {
  console.warn('[WebSocket] Impossible de charger les citations :', e.message);
  quotes = [];
}

// Ping régulier
setInterval(() => {
  clients.forEach(({ ws }, deviceId) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping('keepalive');
    }
  });
}, 15000);

// Connexion
wss.on('connection', (ws) => {
  let deviceId = null; // ⚠️ Déclaré ici

  ws.on('message', async (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      console.log('[WebSocket] Erreur parsing message :', e.message);
      return;
    }

    // Toujours s'assurer que deviceId est défini
    if (!deviceId && data.deviceId) {
      deviceId = String(data.deviceId);
      ws.deviceId = deviceId;
      clients.set(deviceId, { ws });
      console.log(`[WebSocket] Device connecté : ${deviceId}`);
    }

    // Si audio reçu
    if (data.audioBase64) {
      if (!deviceId && data.deviceId) {
        deviceId = String(data.deviceId);
        ws.deviceId = deviceId;
        clients.set(deviceId, { ws });
        console.log(`[WebSocket] Device connecté tardivement : ${deviceId}`);
      }

      if (!deviceId) {
        console.warn('[WebSocket] Audio reçu mais deviceId manquant, envoi annulé !');
        return;
      }

      try {
        console.log(`[WebSocket] Audio reçu de ${deviceId}, taille base64: ${data.audioBase64.length}`);
        await assemblyService.processAudioAndReturnJSON(data.audioBase64, deviceId, true);  // ✅ Passer deviceId
      } catch (err) {
        console.error('[WebSocket] Erreur traitement audio pour', deviceId, err.message);
      }
    }

    // === Cas GPT ===
    if (data.type) {
      let prompt, typeResponse;
      const userText = data.text || data.texte || data.userInput || "";

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
          console.warn("[WS] Type inconnu :", data.type);
          return;
      }

      // === Appel GPT ===
      let resultText;
      try {
        const completion = await ws.serverOpenAI.chat.completions.create({
          model: "gpt-4o-search-preview-2025-03-11",
          messages: [{ role: "user", content: prompt }],
        });
        resultText = completion.choices[0].message.content;
      } catch (err) {
        console.error('[WS] Erreur GPT :', err);
        resultText = '{"message":"Erreur appel GPT"}';
      }

      const resultJSON = extractJsonSafely(resultText);
      if (data.analyseIndex !== undefined) resultJSON.analyseIndex = data.analyseIndex;

      const payload = { type: typeResponse, deviceId, ...resultJSON };
      sendToFlutter(payload, deviceId);
    }

    console.log(`[WebSocket] Message reçu de ${deviceId || 'non identifié'} :`, data);
  });

  // Citation aléatoire toutes les 15s
  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN && deviceId && quotes.length > 0) {
      const randomIndex = Math.floor(Math.random() * quotes.length);
      const payload = { quote: quotes[randomIndex].quote };
      try {
        ws.send(JSON.stringify(payload));
      } catch (e) {
        console.warn('[WebSocket] Envoi citation échoué pour', deviceId, e.message);
      }
    }
  }, 15000);

  ws.on('close', () => {
    clearInterval(interval);
    if (deviceId) {
      clients.delete(deviceId);
      console.log(`[WebSocket] Device déconnecté : ${deviceId}`);
    }
  });

  ws.on('pong', (data) => {
    console.log(`[WebSocket] Pong reçu de device ${deviceId || 'inconnu'} :`, data.toString());
  });
}); // ✅ Fermeture correcte de wss.on('connection')

// Envoie un message UNIQUEMENT au device ciblé.
function sendToFlutter(payload, targetDeviceId) {
  if (!targetDeviceId) {
    console.warn('[WebSocket] Envoi bloqué : deviceId manquant !');
    return false;
  }

  const client = clients.get(String(targetDeviceId));
  if (!client || client.ws.readyState !== WebSocket.OPEN) {
    console.warn('[WebSocket] Device introuvable ou socket fermé :', targetDeviceId);
    return false;
  }

  try {
    client.ws.send(JSON.stringify(payload));
    const shortText = typeof payload.text === 'string' ? payload.text.slice(0, 80) : '';
    console.log(`[WebSocket] -> ${targetDeviceId} | index=${payload.index} | text="${shortText}"`);
    return true;
  } catch (e) {
    console.warn('[WebSocket] Échec envoi à', targetDeviceId, e.message);
    return false;
  }
}

// Attacher WS au serveur HTTP + passage de OpenAI
function attachWebSocketToServer(server, openai) {
  wss.on('connection', (ws) => {
    ws.serverOpenAI = openai; // ✅ attache l’instance openai
  });

  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
}

module.exports = { wss, sendToFlutter, clients, attachWebSocketToServer };
