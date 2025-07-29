const { buildSecondAnalysisPrompt } = require('../utils/promptBuilder');

exports.processAnswer = async (req, res) => {
  try {
    const { index, resume, previousQA, diagnostic_precedent } = req.body;

    // Validation simplifiée : index et resume requis, previousQA un tableau non vide
    if (index === undefined || !resume || !Array.isArray(previousQA) || previousQA.length === 0) {
      return res.status(400).json({ error: "Champs requis manquants ou invalides" });
    }

    // Construire le prompt pour la deuxième analyse (causes)
    // index sert pour la numérotation des causes si besoin
    const prompt = buildSecondAnalysisPrompt(resume, previousQA, diagnostic_precedent, index);

    console.log("📤 Prompt envoyé à l'IA (analyse des causes) :\n", prompt);

    const completion = await req.app.locals.openai.chat.completions.create({
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
