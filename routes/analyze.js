const express = require("express");
const router = express.Router();
const { askOpenAI } = require("../controllers/openaiService");
const { buildFirstAnalysisPrompt } = require("../utils/promptBuilder");

// Fonction utilitaire pour extraire proprement le JSON dans la réponse OpenAI
function extractJsonFromContent(content) {
  // Nettoyage des balises Markdown 
json ou

  let cleaned = content.trim();
  cleaned = cleaned.replace(/
json|
/g, "");

  // Remplace les guillemets français par des guillemets ASCII standard
  cleaned = cleaned.replace(/[«»]/g, '"');

  // Recherche début et fin JSON
  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error("Réponse non formatée en JSON");
  }

  const jsonString = cleaned.substring(jsonStart, jsonEnd + 1);

  // Parse JSON
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    throw new Error("JSON mal formé ou invalide : " + e.message);
  }
}

router.post("/", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || text.trim().length < 5) {
      return res.status(400).json({ error: "Texte trop court ou invalide." });
    }

    // 👉 Générer le prompt depuis le texte
    const prompt = buildFirstAnalysisPrompt(text);

    // 👉 Appel à OpenAI
    const content = await askOpenAI(prompt, text);

    // 👉 Extraction robuste du JSON depuis la réponse de l’IA
    const json = extractJsonFromContent(content);

    // ✅ Validation du format
    if (!json.questions || !Array.isArray(json.questions)) {
      throw new Error("JSON mal structuré (questions manquantes)");
    }

    // ✅ Structuration des questions
    const structuredQuestions = json.questions.map((q, i) => ({
      id: i + 1,
      text: q.trim(),
    }));

    // ✅ Réponse finale
    return res.json({
      success: true,
      resume: json.resume || "",
      questions: structuredQuestions,
    });

  } catch (error) {
    console.error("❌ Erreur dans route analyze :", error);
    return res.status(500).json({
      error: "Erreur lors de l’analyse initiale.",
      details: error.message,
    });
  }
});

module.exports = router;
