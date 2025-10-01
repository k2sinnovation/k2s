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
    console.error("Erreur parsing JSON IA :", err, "\nTexte brut :", content);
    return { resume: "", questions: [], causes: [], message: "Erreur parsing JSON IA" };
  }
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

} else if (data.type === 'analyze_request') { // ← ajout
    const qaFormatted = data.previousQA && data.previousQA.length > 0
      ? data.previousQA.map((item, idx) => `Q${idx + 1}: ${item.question}\nR: ${item.reponse}`).join('\n\n')
      : "Aucune question précédente.";

    prompt = buildFirstAnalysisPrompt(data.userInput, qaFormatted);
    typeResponse = 'analyze_response'; // correspond au Flutter Completer

} else if (data.type === 'final_analysis_request') {
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
          model: "gpt-4o-search-preview-2025-03-11",
          messages: [{ role: "user", content: prompt }],
        });
  
        const resultText = completion.choices[0].message.content;
        console.log('[WS] Texte brut GPT reçu :', resultText);

        // Utilisation du parsing tolérant
        const resultJSON = extractJsonSafely(resultText);
        console.log('[WS] JSON extrait :', resultJSON);

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




