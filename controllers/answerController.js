const { buildFirstAnalysisPrompt, buildSecondAnalysisPrompt } = require('../utils/promptBuilder');

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
      const qaFormatted = previousQA.map((item, idx) => `Q${idx + 1}: ${item.question}\nR: ${item.reponse}`).join('\n\n');
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
      const resultJSON = JSON.parse(resultText);
      return res.json({ diagnostic: resultJSON });
    } catch (parseError) {
      console.error("❌ Erreur de parsing JSON IA :", parseError);
      return res.status(500).json({ error: "Réponse IA invalide. Format JSON attendu non respecté." });
    }

  } catch (error) {
    console.error("Erreur dans processAnswer :", error);
    return res.status(500).json({ error: "Erreur serveur interne" });
  }
};

