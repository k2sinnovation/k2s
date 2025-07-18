// controllers/answerController.js
const { getOpenAIResponse } = require('../services/openaiService');
const { buildAnswerPrompt } = require('../utils/promptBuilder');

exports.generateAnswer = async (req, res) => {
  try {
    const { resume, questions, answers } = req.body;

    if (!resume || !questions || !answers || answers.length !== 5) {
      return res.status(400).json({ error: 'Champs manquants ou invalides.' });
    }

    const prompt = buildAnswerPrompt(resume, questions, answers);
    const aiResponse = await getOpenAIResponse(prompt);

    const jsonData = JSON.parse(aiResponse);
    return res.status(200).json(jsonData);

  } catch (error) {
    console.error('Erreur dans /answer :', error.message);
    return res.status(500).json({ error: 'Erreur lors du diagnostic.' });
  }
};
