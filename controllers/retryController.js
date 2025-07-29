const { buildFinalAnalysisPrompt } = require('../utils/promptBuilder');

exports.retryFinalDiagnosis = async (req, res) => {
  try {
    const {
      resume,
      previousQA,
      diagnostic_precedent
    } = req.body;

    // Validation des champs
    if ( !resume || !previousQA || previousQA.length === 0 || !diagnostic_precedent) {
      return res.status(400).json({ error: "Champs requis manquants ou invalides" });
    }

    const openai = req.app.locals.openai;

    // Génération du prompt (prompt3)
    const prompt = buildFinalAnalysisPrompt(resume, diagnostic_precedent, previousQA);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });

    const result = completion.choices[0].message.content;
    return res.json({ diagnostic: result });

  } catch (error) {
    console.error("Erreur dans retryFinalDiagnosis :", error);
    return res.status(500).json({ error: "Erreur serveur interne" });
  }
};

