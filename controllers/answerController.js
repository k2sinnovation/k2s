const WebSocket = require('ws');
const { buildFirstAnalysisPrompt, buildSecondAnalysisPrompt } = require('../utils/promptBuilder');

// Normalisation JSON
function normalizeJsonString(jsonStr) {
  return jsonStr
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00A0/g, ' ')
    .trim();
}

// Extraction JSON tolérante
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

const clients = new Map();

function setupWebSocketServer(server, openai) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    let deviceId = null;
    console.log("[WS] Nouveau client connecté");

    ws.on('message', async (rawMessage) => {
      try {
        const data = JSON.parse(rawMessage);
        deviceId = data.deviceId || data.deviceID || data["ID de périphérique"] || deviceId;
        if (!deviceId) return;

        const userText = data.text || data.texte || data.userInput || "";
        clients.set(deviceId, ws);

        let prompt, typeResponse;

        switch (data.type) {
          case 'questions_request':
            const qaFormattedQ = data.previousQA?.length
              ? data.previousQA.map((item, idx) => `Q${idx + 1}: ${item.question}\nR: ${item.reponse}`).join('\n\n')
              : "Aucune question précédente.";
            prompt = buildFirstAnalysisPrompt(userText, qaFormattedQ);
            typeResponse = 'questions_response';
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

          case 'analyze_request':
            const qaFormattedA = data.previousQA?.length
              ? data.previousQA.map((item, idx) => `Q${idx + 1}: ${item.question}\nR: ${item.reponse}`).join('\n\n')
              : "Aucune question précédente.";
            prompt = buildFirstAnalysisPrompt(userText, qaFormattedA);
            typeResponse = 'analyze_response';
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
            return;
        }

        let resultText;
        try {
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
          });
          resultText = completion.choices[0].message.content;
        } catch (err) {
          console.error('[WS] Erreur GPT :', err);
          resultText = '{"message":"Erreur lors de l’appel GPT"}';
        }

        const resultJSON = extractJsonSafely(resultText);

        // Ajouter analyseIndex dans payload pour Flutter
        if (data.analyseIndex !== undefined) resultJSON.analyseIndex = data.analyseIndex;

        if (clients.has(deviceId)) {
          const payload = {
            type: typeResponse,
            deviceId,
            ...resultJSON
          };
          clients.get(deviceId).send(JSON.stringify(payload));
        }

      } catch (err) {
        console.error(`[WS] Erreur WS pour device ${deviceId} :`, err);
      }
    });

    ws.on('close', () => {
      if (deviceId) clients.delete(deviceId);
      console.log(`[WS] Device déconnecté : ${deviceId}`);
    });
  });

  console.log("[WS] WebSocket server prêt !");
}

module.exports = { setupWebSocketServer };


