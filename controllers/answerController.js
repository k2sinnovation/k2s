const { buildSecondAnalysisPrompt, buildFinalAnalysisPrompt } = require('../utils/promptBuilder');
console.log("📤 Prompt envoyé à l'IA (prompt2):\n", prompt);


exports.processAnswer = async (req, res) => {
  try {
    const { index, resume, previousQA, diagnostic_precedent } = req.body;

    if (!index || !resume || !previousQA || previousQA.length === 0) {
      return res.status(400).json({ error: "Champs requis manquants ou invalides" });
    }

    const openai = req.app.locals.openai;
    let prompt;

    if (index === 3) {
      if (!diagnostic_precedent) {
        return res.status(400).json({ error: "Diagnostic précédent requis pour l'analyse finale" });
      }
      prompt = buildFinalAnalysisPrompt( resume, diagnostic_precedent, previousQA);
      console.log("📌 Résumé :", resume);
console.log("🛠️ Causes proposées :", causes);
console.log("🧪 Vérifications recommandées :", verifications);

    } else {
      prompt = buildSecondAnalysisPrompt( resume, previousQA, diagnostic_precedent);
      console.log("📌 Résumé :", resume);
console.log("🛠️ Causes proposées :", causes);
console.log("🧪 Vérifications recommandées :", verifications);

    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const result = completion.choices[0].message.content;
    return res.json({ diagnostic: result });
    

  } catch (error) {
    console.error("Erreur dans processAnswer :", error);
    return res.status(500).json({ error: "Erreur serveur interne" });
  }
};
