const express = require("express");
const router = express.Router();
const { askOpenAI } = require("../controllers/openaiService");
const { buildFirstAnalysisPrompt } = require("../utils/promptBuilder");

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
    const jsonStart = content.indexOf("{");
    const jsonEnd = content.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
      throw new Error("Réponse non formatée en JSON");
    }

    const jsonString = content.substring(jsonStart, jsonEnd + 1);
    let json;
    try {
      json = JSON.parse(jsonString);
    } catch (e) {
      throw new Error("JSON mal formé ou invalide");
    }

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
