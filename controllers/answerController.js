const { buildFirstAnalysisPrompt, buildSecondAnalysisPrompt } = require('../utils/promptBuilder');

// 🔹 Fonction utilitaire pour extraire un JSON valide même si l'IA ajoute du texte autour
function extractJsonFromContent(content) {
  let cleaned = content.trim();

  // Supprime balises Markdown éventuelles
  cleaned = cleaned.replace(/```json|```/g, "");

  // Normalise guillemets français
  cleaned = cleaned.replace(/[«»]/g, '"');

  // Cherche la première accolade ouvrante et la dernière fermante
  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error("Réponse IA non formatée en JSON");
  }

  const jsonString = cleaned.substring(jsonStart, jsonEnd + 1);

  return JSON.parse(jsonString);
}

exports.processAnswer = async (req, res) => {
  try {
    const { index, resume, previousQA, diagnostic_precedent } = req.body;

    // Validation simplifiée
    if (index === undefined || !resume || !Array.isArray(previousQA) || previousQA.length === 0) {
      return res.status(400).json({ error: "Champs requis manquants ou invalides" });
    }

    let prompt;
    let promptType;

    if (index === 0) {
      // Analyse initiale : génération des 5 questions fermées
      const qaFormatted = previousQA
        .map((item, idx) => `Q${idx + 1}: ${item.question}\nR: ${item.reponse}`)
        .join('\n\n');
      prompt = buildFirstAnalysisPrompt(resume, qaFormatted);
      promptType = "🟡 Analyse 0 → Génération de 5 questions fermées";
    } else {
      // Analyse suivante : génération des causes/actions
      prompt = buildSecondAnalysisPrompt(resume, previousQA, diagnostic_precedent, index);
      const start = index * 4 + 1;
      const end = start + 3;
      promptType = `🟠 Analyse ${index} → Causes ${start} à ${end}`;
    }

    console.log(`📤 Prompt envoyé à l'IA (${promptType}) :\n${prompt}`);

    const completion = await req.app.locals.openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const resultText = completion.choices[0].message.content;

    try {
      // ✅ Extraction robuste JSON
      const resultJSON = extractJsonFromContent(resultText);

      return res.json({ diagnostic: resultJSON });
    } catch (parseError) {
      console.error("❌ Erreur de parsing JSON IA :", parseError, "\nTexte brut reçu :", resultText);
      return res.status(500).json({
        error: "Réponse IA invalide. Format JSON attendu non respecté.",
        raw: resultText, // 🔎 utile pour debug côté client
      });
    }

  } catch (error) {
    console.error("Erreur dans processAnswer :", error);
    return res.status(500).json({ error: "Erreur serveur interne" });
  }
};
