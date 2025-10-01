const WebSocket = require('ws');
const { buildFirstAnalysisPrompt, buildSecondAnalysisPrompt } = require('../utils/promptBuilder');

// Normalise les guillemets et espaces spéciaux
function normalizeJsonString(jsonStr) {
  return jsonStr
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00A0/g, ' ')
    .trim();
}

// Extraction JSON tolérante, même si l'IA ajoute du texte
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
      message: json.message || ""
    };
  } catch (err) {
    console.error("[WS] Erreur parsing JSON IA :", err, "\nTexte brut :", content);
    return { resume: "", questions: [], causes: [], message: "Erreur parsing JSON IA" };
  }
}

// Map pour gérer plusieurs utilisateurs (deviceId → ws)
const clients = new Map();

function setupWebSocketServer(server, openai) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    let deviceId = null;
    console.log("[WS] Nouveau client connecté");

    ws.on('message', async (rawMessage) => {
      try {
        console.log("[WS] Message brut reçu :", rawMessage);

        const data = JSON.parse(rawMessage);

        // 🔥 Normalisation pour être compatible même si le client envoie un mauvais champ
        deviceId = data.deviceId || data.deviceID || data["ID de périphérique"] || deviceId;

        if (!deviceId) {
          console.warn("[WS] Pas de deviceId, message ignoré");
          return;
        }

        // Stocker la socket associée à ce deviceId
        clients.set(deviceId, ws);
        console.log(`[WS] Client enregistré pour deviceId ${deviceId}`);

        let prompt, typeResponse;

        // --- Sélection du type de requête ---
        switch (data.type) {
          case 'questions_request':
            console.log(`[WS] Requête questions_request reçue pour device ${deviceId}`);
            const qaFormattedQ = data.previousQA && data.previousQA.length > 0
              ? data.previousQA.map((item, idx) => `Q${idx + 1}: ${item.question}\nR: ${item.reponse}`).join('\n\n')
              : "Aucune question précédente.";
            prompt = buildFirstAnalysisPrompt(data.text, qaFormattedQ);
            typeResponse = 'questions_response';
            break;

          case 'answer_request':
            console.log(`[WS] Requête answer_request reçue pour device ${deviceId}`);
            prompt = buildSecondAnalysisPrompt(
              data.resume || '',
              data.previousQA || [],
              data.diagnostic_precedent || '',
              data.analyseIndex || 1
            );
            typeResponse = 'answer_response';
            break;

          case 'analyze_request':
            console.log(`[WS] Requête analyze_request reçue pour device ${deviceId}`);
            const qaFormattedA = data.previousQA && data.previousQA.length > 0
              ? data.previousQA.map((item, idx) => `Q${idx + 1}: ${item.question}\nR: ${item.reponse}`).join('\n\n')
              : "Aucune question précédente.";
            prompt = buildFirstAnalysisPrompt(data.userInput, qaFormattedA);
            typeResponse = 'analyze_response';
            break;

          case 'final_analysis_request':
            console.log(`[WS] Requête final_analysis_request reçue pour device ${deviceId}`);
            prompt = buildSecondAnalysisPrompt(
              data.resume || '',
              [],
              '',
              data.analyseIndex || 1
            );
            typeResponse = 'final_analysis_response';
            break;

          default:
            console.warn(`[WS] Type de message inconnu : ${data.type}`);
            return;
        }

        console.log(`[WS] Prompt construit pour device ${deviceId} :\n`, prompt);

        // --- Appel GPT ---
        let resultText;
        try {
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-search-preview-2025-03-11",
            messages: [{ role: "user", content: prompt }],
          });
          resultText = completion.choices[0].message.content;
          console.log('[WS] Texte brut GPT reçu :', resultText);
        } catch (err) {
          console.error('[WS] Erreur lors de l’appel GPT :', err);
          resultText = '{"message":"Erreur lors de l’appel GPT"}';
        }

        // --- Parsing JSON ---
        const resultJSON = extractJsonSafely(resultText);
        console.log('[WS] JSON extrait :', resultJSON);

        // --- Envoi au client ---
        if (clients.has(deviceId)) {
          const payload = {
            type: typeResponse,
            deviceId, // 🔥 toujours cohérent avec Flutter
            ...resultJSON
          };
          console.log('[WS] Envoi au client :', payload);
          clients.get(deviceId).send(JSON.stringify(payload));
        } else {
          console.warn(`[WS] DeviceId ${deviceId} introuvable dans clients`);
        }

      } catch (err) {
        console.error(`[WS] Erreur WS pour device ${deviceId} et message :`, rawMessage, "\n", err);
      }
    });

    ws.on('close', () => {
      if (deviceId && clients.has(deviceId)) {
        clients.delete(deviceId);
        console.log(`[WS] Device déconnecté : ${deviceId}`);
      } else {
        console.log("[WS] Client déconnecté sans deviceId connu");
      }
    });
  });

  console.log("[WS] WebSocket server prêt !");
}

module.exports = { setupWebSocketServer };
