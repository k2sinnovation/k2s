const { getOpenAIResponse } = require('../services/openaiService');
const {
  buildAnswerPrompt,
  buildFinalDiagnosisPrompt
} = require('../utils/promptBuilder');

exports.generateAnswer = async (req, res) => {
  try {
    const { resume, questions, answers, index, previousDiagnosis } = req.body;

    if (!resume || !questions || !answers || typeof index !== 'number') {
      return res.status(400).json({ error: 'Champs requis manquants ou invalides.' });
    }

    let prompt = '';

    if (index === 3) {
      // 🔴 Dernière tentative — Utiliser prompt3
      prompt = buildFinalDiagnosisPrompt(resume, questions, answers, previousDiagnosis);
    } else {
      // 🟢 ou 🟠 analyse 1 ou 2 — Utiliser prompt2
      prompt = buildAnswerPrompt(resume, questions, answers, previousDiagnosis);
    }

    const aiResponse = await getOpenAIResponse(prompt);
    const jsonData = JSON.parse(aiResponse);

    return res.status(200).json(jsonData);

  } catch (error) {
    console.error('Erreur dans /answer :', error.message);
    return res.status(500).json({ error: 'Erreur lors du traitement du diagnostic.' });
  }
};
