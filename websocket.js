const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const assemblyService = require('./controllers/assemblyService');
const { buildFirstAnalysisPrompt, buildSecondAnalysisPrompt } = require('./utils/promptBuilder');

const clients = new Map(); // Map<deviceId, { ws }>

// --------------------
// Utils pour parsing JSON IA
// --------------------
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

// --------------------
// Lire les citations
// --------------------
let quotes = [];
try {
  const raw = fs.readFileSync(path.join(__dirname, 'utils', 'citation'), 'utf8');
  quotes = JSON.parse(raw);
} catch (e) {
  console.warn('[WebSocket] Impossible de charger les citations :', e.message);
  quotes = [];
}

// --------------------
// Ping régulier
// --------------------
function startPing() {
  setInterval(() => {
    clients.forEach(({ ws }, deviceId) => {
      if (ws.readyState === WebSocket.OPEN) ws.ping('keepalive');
    });
  }, 15000);
}
startPing();

// --------------------
// Envoi d’un message
// --------------------
function sendToFlutter(payload, targetDeviceId) {
  if (!targetDeviceId) return false;
  const client = clients.get(String(targetDeviceId));
  if (!client || client.ws.readyState !== WebSocket.OPEN) return false;

  try {
    client.ws.send(JSON.stringify(payload));
    console.log(`[WS] ✅ Message envoyé à ${targetDeviceId}: type=${payload.type}`);
    return true;
  } catch (e) {
    console.warn('[WebSocket] ❌ Échec envoi à', targetDeviceId, e.message);
    return false;
  }
}

// --------------------
// Serveur WebSocket
// --------------------
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
    console.log('[WS] 🔗 Nouveau client connecté');

    // Interval pour citations automatiques
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
        console.error('[WS] ❌ JSON invalide', err.message);
        return;
      }

      // ✅ PRIORITÉ 1 : Connexion explicite
      if (data.type === 'connect' && data.deviceId) {
        deviceId = String(data.deviceId);
        clients.set(deviceId, { ws });
        console.log('[WS] ✅ Device connecté :', deviceId);
        return; // Sortir ici, ne rien faire d'autre
      }

      // ✅ PRIORITÉ 2 : Extraction deviceId si pas encore fait
      if (!deviceId && data.deviceId) {
        deviceId = String(data.deviceId);
        clients.set(deviceId, { ws });
        console.log('[WS] ⚙️ Device ID extrait du message:', deviceId);
      }

      // Si toujours pas de deviceId, abandonner
      if (!deviceId) {
        console.warn('[WS] ⚠️ deviceId manquant, message ignoré:', data.type);
        return;
      }

      console.log(`[WS] 📩 Reçu de ${deviceId}:`, data.type || 'type inconnu');

// Gestion des chunks audio
if (data.type === 'audio_chunk' && data.audioBase64) {
  try {
    const commit = data.commit || false;
    console.log(`[WS] 🎤 Chunk audio reçu (${data.audioBase64.length} chars, commit=${commit})`);
    
    await assemblyService.processAudioChunk(
      deviceId, 
      data.audioBase64, 
      clients,  // ✅ Passer la Map complète
      commit
    );
  } catch (err) {
    console.error('[WS] ❌ Erreur traitement audio :', err.message);
    sendToFlutter({ type: 'audio_error', deviceId, message: err.message }, deviceId);
  }
}
      // Gestion GPT
      if (data.type && ws.serverOpenAI) {
        let prompt, typeResponse;
        const userText = data.text || data.userInput || "";

        switch (data.type) {
          case 'questions_request': {
            const qaQ = data.previousQA?.length
              ? data.previousQA.map((item, idx) => `Q${idx+1}: ${item.question}\nR: ${item.reponse}`).join('\n\n')
              : "Aucune question précédente.";
            prompt = buildFirstAnalysisPrompt(userText, qaQ);
            typeResponse = 'questions_response';
            break;
          }

          case 'analyze_request': {
            const qaA = data.previousQA?.length
              ? data.previousQA.map((item, idx) => `Q${idx+1}: ${item.question}\nR: ${item.reponse}`).join('\n\n')
              : "Aucune question précédente.";
            prompt = buildFirstAnalysisPrompt(userText, qaA);
            typeResponse = 'analyze_response';
            break;
          }

          case 'answer_request': {
            const answersText = data.answers
              ? Object.entries(data.answers).map(([q, r]) => `Q: ${q}\nR: ${r}`).join("\n\n")
              : "Aucune réponse utilisateur fournie.";

            prompt = buildSecondAnalysisPrompt(
              data.resume || userText,
              data.previousQA || [],
              data.diagnostic_precedent || '',
              data.analyseIndex || 1
            ) + "\n\nRéponses utilisateur:\n" + answersText;

            typeResponse = 'answer_response';
            break;
          }

          case 'final_analysis_request': {
            prompt = buildSecondAnalysisPrompt(
              data.resume || userText,
              [],
              '',
              data.analyseIndex || 1
            );
            typeResponse = 'final_analysis_response';
            break;
          }

          default:
            console.warn('[WS] ⚠️ Type inconnu :', data.type);
            return;
        }

        console.log("[WS] 🧾 Prompt généré :", prompt);

        try {
          const completion = await ws.serverOpenAI.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
          });

          const resultText = completion.choices[0].message.content;
          console.log("[WS] 📤 Réponse brute GPT :", resultText);

          const resultJSON = extractJsonSafely(resultText);
          if (data.analyseIndex !== undefined) resultJSON.analyseIndex = data.analyseIndex;

          console.log("[WS] 📦 Réponse JSON nettoyée :", resultJSON);

          sendToFlutter({ type: typeResponse, deviceId, ...resultJSON }, deviceId);
        } catch (err) {
          console.error('[WS] ❌ Erreur GPT :', err);
          sendToFlutter({ type: typeResponse, deviceId, message: 'Erreur GPT' }, deviceId);
        }
      }
    });

    ws.on('close', () => {
      clearInterval(citationInterval);
      if (deviceId) {
        clients.delete(deviceId);
        console.log('[WS] 🔌 Device déconnecté :', deviceId);
      }
    });

    ws.on('pong', (data) => {
      console.log(`[WS] 🏓 Pong reçu de device ${deviceId || 'inconnu'} :`, data.toString());
    });
  });

  console.log('[WS] 🚀 WebSocket server prêt !');
}

module.exports = { attachWebSocketToServer, clients, sendToFlutter };
