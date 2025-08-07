const express = require("express");
const router = express.Router();
const { askOpenAI } = require("../controllers/openaiService");
const { buildFirstAnalysisPrompt, buildSecondAnalysisPrompt } = require("../utils/promptBuilder");

// Extraction JSON robuste, nettoie balises markdown, etc.
function extractJsonFromContent(content) {
  let cleaned = content.trim();
  cleaned = cleaned.replace(/```json|```/g, "");
  cleaned = cleaned.replace(/[«»]/g, '"');
  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error("Réponse non formatée en JSON");
  }
  const jsonString = cleaned.substring(jsonStart, jsonEnd + 1);
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    throw new Error("JSON mal formé ou invalide : " + e.message);
  }
}

router.post("/", async (req, res) => {
  try {
    const {
      description,
      previousQA = [],
      resume = "",
      diagnosticPrecedent = "",
      analyseIndex = 0,
    } = req.body;

    if (!description || description.trim().length < 5) {
      return res.status(400).json({ error: "Description trop courte ou absente." });
    }

    const isFirstAnalysis = analyseIndex === 0;
    const hasResume = resume && resume.trim().length >= 5;

    let prompt;

    if (isFirstAnalysis) {
      // Format questions/réponses précédentes
      const qaFormatted = previousQA
        .map((item, idx) => `Question ${idx + 1} : ${item.question}\nRéponse : ${item.reponse}`)
        .join("\n\n");

      prompt = buildFirstAnalysisPrompt(description, qaFormatted);
    } else {
      // Analyse approfondie (index 1, 2, ...)
      const safeResume = hasResume ? resume.trim() : description.trim();
      prompt = buildSecondAnalysisPrompt(safeResume, previousQA, diagnosticPrecedent, analyseIndex);
    }

    const content = await askOpenAI(prompt, description);
    const json = extractJsonFromContent(content);

    if (isFirstAnalysis) {
      if (!json.questions || !Array.isArray(json.questions)) {
        throw new Error("JSON mal structuré (questions manquantes)");
      }
      const structuredQuestions = json.questions.map((q, i) => ({
        id: i + 1,
        text: q.trim(),
      }));
      return res.json({
        success: true,
        resume: json.resume || "",
        questions: structuredQuestions,
      });
    } else {
      if (!json.causes || !Array.isArray(json.causes)) {
        throw new Error("JSON mal structuré (causes manquantes)");
      }
      return res.json({
        success: true,
        causes: json.causes,
        message: json.message || "",
      });
    }

  } catch (error) {
    console.error("❌ Erreur dans /analyze :", error);
    return res.status(500).json({
      error: "Erreur lors de l'analyse.",
      details: error.message,
    });
  }
});

module.exports = router;
