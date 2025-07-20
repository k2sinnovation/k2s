const { buildFirstAnalysisPrompt } = require('../utils/promptHelper');
const { askOpenAI } = require('../openaiService');

exports.analyzeText = async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || text.trim() === '') {
      return res.status(400).json({ error: 'Texte requis pour l’analyse.' }); // ✅ AJOUT : vérification entrée
    }

    const prompt = buildFirstAnalysisPrompt(text);
    const response = await askOpenAI(prompt, text);

    if (!Array.isArray(response)) {
      return res.status(500).json({ error: 'Format inattendu depuis OpenAI (tableau requis).' }); // ✅ AJOUT : contrôle format
    }

    res.status(200).json({ questions: response }); // 🔄 MODIFICATION : ajout du statut + format clair Flutter

  } catch (error) {
    console.error("Erreur analyseText:", error); // 🔄 MODIFICATION : message plus précis
    res.status(500).json({ error: "Erreur serveur" });
  }
};
