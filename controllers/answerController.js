const WebSocket = require('ws');
const { buildFirstAnalysisPrompt, buildSecondAnalysisPrompt } = require('../utils/promptBuilder');

function normalizeJsonString(jsonStr) {
  return jsonStr
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00A0/g, ' ')
    .trim();
}

function extractJsonFromContent(content) {
  let cleaned = content.trim();
  cleaned = cleaned.replace(/```json|```/g, "");
  cleaned = cleaned.replace(/[«»]/g, '"');

  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error("Réponse IA non formatée en JSON");
  }

  const jsonString = cleaned.substring(jsonStart, jsonEnd + 1);
  return JSON.parse(jsonString);
}

// Map pour gérer plusieurs utilisateurs (deviceId → ws)
const clients = new Map();

function setupWebSocketServer(server, openai) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    let deviceId = null;

    ws.on('message', async (rawMessage) => {
      try {
        const data = JSON.parse(rawMessage);
        deviceId = data.deviceId || deviceId;

        if (!deviceId) return;

        // Stocker le client pour ce deviceId
        clients.set(deviceId, ws);

        let prompt, typeResponse;

        if (data.type === 'questions_request') {
          const qaFormatted = data.previousQA && data.previousQA.length > 0
            ? data.previousQA.map((item, idx) => `Q${idx + 1}: ${item.question}\nR: ${item.reponse}`).join('\n\n')
            : "Aucune question précédente.";

          prompt = buildFirstAnalysisPrompt(data.text, qaFormatted);
          typeResponse = 'questions_response';

        } else if (data.type === 'answer_request') {
          prompt = buildSecondAnalysisPrompt(
            data.resume || '',
            data.previousQA || [],
            data.diagnostic_precedent || '',
            data.analyseIndex || 1
          );
          typeResponse = 'answer_response';

        } else if (data.type === 'final_analysis_request') {
          // Optionnel : si tu veux gérer analyse finale
          prompt = buildSecondAnalysisPrompt(
            data.resume || '',
            [],
            '',
            data.analyseIndex || 1
          );
          typeResponse = 'final_analysis_response';
        } else {
          return;
        }

        console.log(`[WS] Prompt pour device ${deviceId} :\n`, prompt);

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-2024-08-06",
          messages: [{ role: "user", content: prompt }],
        });

        const resultText = completion.choices[0].message.content;

        let resultJSON;
        try {
          const cleanedText = normalizeJsonString(resultText);
          resultJSON = extractJsonFromContent(cleanedText);
        } catch (err) {
          console.error("Erreur parsing JSON IA :", err, "\nTexte brut :", resultText);
          resultJSON = { causes: [], questions: [], resume: '', message: 'Erreur parsing JSON IA' };
        }

        // Envoi au client correspondant
        if (clients.has(deviceId)) {
          clients.get(deviceId).send(JSON.stringify({
            type: typeResponse,
            deviceId,
            ...resultJSON
          }));
        }

      } catch (err) {
        console.error("Erreur WS :", err);
      }
    });

    ws.on('close', () => {
      if (deviceId && clients.has(deviceId)) {
        clients.delete(deviceId);
        console.log(`[WS] Device déconnecté : ${deviceId}`);
      }
    });
  });

  console.log("[WS] WebSocket server prêt !");
}

module.exports = { setupWebSocketServer };
