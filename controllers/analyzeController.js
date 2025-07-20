// controllers/analyzeController.js
const { buildFirstAnalysisPrompt } = require("../utils/promptBuilder");
const { askOpenAI } = require("./openaiService");

async function analyzeRequest(req, res) {
  try {
    const { description } = req.body;

    if (!description || description.trim().length < 5) {
      return res.status(400).json({ error: "Description trop courte ou absente." });
    }

    const prompt = buildFirstAnalysisPrompt(description);

    const aiResponse = await askOpenAI(prompt, description);

    // Extraction JSON
    const jsonStart = aiResponse.indexOf("{");
    const jsonEnd = aiResponse.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
      throw new Error("Réponse OpenAI non formatée en JSON.");
    }

    const jsonString = aiResponse.substring(jsonStart, jsonEnd + 1);
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e) {
      throw new Error("Impossible de parser le JSON retourné.");
    }

    if (!parsed.questions || !Array.isArray(parsed.questions)) {
      throw new Error("Champ 'questions' manquant ou invalide.");
    }

    const structuredQuestions = parsed.questions.map((q, i) => ({
      id: i + 1,
      text: q.trim(),
    }));

    return res.json({
      success: true,
      resume: parsed.resume || "",
      questions: structuredQuestions,
    });

  } catch (error) {
    console.error("❌ Erreur dans analyzeController:", error);
    return res.status(500).json({
      success: false,
      error: "Erreur lors de l’analyse initiale.",
      details: error.message,
    });
  }
}

module.exports = { analyzeRequest };
