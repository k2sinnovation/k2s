// controllers/analyzeController.js

const { buildFirstAnalysisPrompt } = require("../utils/promptBuilder");

/**
 * Analyse initiale : génère 5 questions fermées à partir d'une description.
 */
async function analyzeRequest(req, res) {
  try {
    const openai = req.app.locals.openai;

    const { description } = req.body;

    if (!description || description.trim().length < 5) {
      return res.status(400).json({ error: "Description trop courte ou absente." });
    }

    // Générer le prompt pour GPT
    const prompt = buildFirstAnalysisPrompt(description);

    // Appel OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
    });

    const content = completion.choices[0].message.content;

    // Essayer d'extraire et parser un JSON dans la réponse
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Réponse non formatée en JSON");
    }

    const json = JSON.parse(match[0]);

    if (!json.questions || !Array.isArray(json.questions)) {
      throw new Error("JSON mal structuré (questions manquantes)");
    }

    // Formater les questions individuellement
    const structuredQuestions = json.questions.map((q, i) => ({
      id: i + 1,
      text: q
    }));

    return res.json({
      success: true,
      resume: json.resume || "",
      questions: structuredQuestions, // tableau [{id, text}]
    });

  } catch (error) {
    console.error("❌ Erreur dans analyzeController :", error);
    return res.status(500).json({
      error: "Erreur lors de l'analyse initiale.",
      details: error.message,
    });
  }
}

module.exports = {
  analyzeRequest
};
