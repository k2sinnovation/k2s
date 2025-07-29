const { askOpenAI } = require("../controllers/openaiService");
const { buildFirstAnalysisPrompt } = require("../utils/promptBuilder");
console.log("📤 Prompt envoyé à l'IA (prompt1):\n", prompt);


async function analyzeRequest(req, res) {
  try {
    const { description } = req.body;

    if (!description || description.trim().length < 5) {
      return res.status(400).json({ error: "Description trop courte ou absente." });
    }

    // Construire le prompt
    const prompt = buildFirstAnalysisPrompt(description);

    // Appel à OpenAI via la fonction du service
    const content = await askOpenAI(prompt, description);
    console.log("📥 Réponse brute de l'IA (prompt1):\n", response);

    // Extraction robuste du JSON : on cherche la première accolade ouvrante et la dernière fermante
   let json;
try {
  // 👉 Essayons de parser automatiquement un JSON bien formé
  json = JSON.parse(content);
} catch (e) {
  // 👉 Sinon on tente d’extraire entre les accolades
  const jsonStart = content.indexOf("{");
  const jsonEnd = content.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    console.error("Réponse IA sans JSON valide :", content);
    throw new Error("Réponse non formatée en JSON");
  }
  const jsonString = content.substring(jsonStart, jsonEnd + 1);
  try {
    json = JSON.parse(jsonString);
  } catch (err) {
    console.error("JSON extrait mais invalide :", jsonString);
    throw new Error("JSON mal formé ou invalide");
  }
}

    if (!json.questions || !Array.isArray(json.questions)) {
      throw new Error("JSON mal structuré (questions manquantes)");
    }

    const structuredQuestions = json.questions.map((q, i) => ({
      id: i + 1,
      text: q.trim()
    }));

    return res.json({
      success: true,
      resume: json.resume || "",
      questions: structuredQuestions,
      console.log("📌 Résumé reçu :", resume);
console.log("❓ Questions reçues :", questions);

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
  analyzeRequest,
};
