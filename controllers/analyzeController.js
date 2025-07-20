// controllers/analyzeController.js
const { getPromptFromText } = require('../utils/promptHelper');
const { callOpenAI } = require('./openaiService');

exports.analyzeText = async (req, res) => {
  try {
    const { text, user_id } = req.body;

    if (!text || text.trim().length < 10) {
      return res.status(400).json({ error: "Texte trop court pour une analyse." });
    }

    const prompt = getPromptFromText(text);
    const json = await callOpenAI(prompt);

    if (!json || !json.questions || !Array.isArray(json.questions)) {
      return res.status(500).json({ error: "Réponse IA invalide ou incomplète." });
    }

    // ✅ Format simple : liste de chaînes
    const structuredQuestions = json.questions.map(q => q.trim());

    return res.json({
      success: true,
      resume: json.resume || "",
      questions: structuredQuestions,
    });
  } catch (error) {
    console.error("Erreur analyseText :", error);
    return res.status(500).json({ error: "Erreur serveur lors de l’analyse." });
  }
};
