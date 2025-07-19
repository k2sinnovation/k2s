const { buildFirstAnalysisPrompt } = require("../utils/promptBuilder");

async function analyzeRequest(req, res) {
  try {
    const openai = req.app.locals.openai;
    const { description } = req.body;

    if (!description || description.trim().length < 5) {
      return res.status(400).json({ error: "Description trop courte ou absente." });
    }

    const prompt = buildFirstAnalysisPrompt(description);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 400,
    });

    const content = completion.choices[0].message.content;

    // Extraction JSON robuste
    const jsonStart = content.indexOf('{');
    const jsonEnd = content.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
      throw new Error("Réponse non formatée en JSON");
    }

    const jsonString = content.substring(jsonStart, jsonEnd + 1);

    let json;
    try {
      json = JSON.parse(jsonString);
    } catch (e) {
      throw new Error("JSON invalide ou mal formé");
    }

    if (!json.questions || !Array.isArray(json.questions)) {
      throw new Error("JSON mal structuré (questions manquantes)");
    }

    const structuredQuestions = json.questions.map((q, i) => ({
      id: i + 1,
      text: q.trim(),
    }));

    return res.json({
      success: true,
      resume: json.resume || "",
      questions: structuredQuestions,
    });
  } catch (error) {
    console.error("❌ Erreur dans analyzeController :", error);
    return res.status(500).json({
      error: "Erreur lors de l'analyse initiale.",
      details: error.message,
    });
  }
}

module.exports = { analyzeRequest };
