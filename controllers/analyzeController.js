const { askOpenAI } = require("../controllers/openaiService");
const { buildFirstAnalysisPrompt, buildSecondAnalysisPrompt } = require("../utils/promptBuilder");

async function analyzeRequest(req, res) {
  try {
    const {
      description,
      previousQA = [],
      resume = "",
      diagnosticPrecedent = "",
      analyseIndex = 2,
    } = req.body;

    console.log("🧾 Données reçues :", {
      description,
      analyseIndex,
      previousQAcount: previousQA.length,
    });

    if (!description || description.trim().length < 5) {
      return res.status(400).json({ error: "Description trop courte ou absente." });
    }

    console.log(`Réception d'une requête pour l'analyse n°${analyseIndex}`);

    let prompt;

    if (analyseIndex === 1) {
      // 1ère analyse : pose des questions
      const qaFormatted = previousQA
        .map((item, idx) => `Question ${idx + 1} : ${item.question}\nRéponse : ${item.reponse}`)
        .join("\n\n");

      prompt = buildFirstAnalysisPrompt(description, qaFormatted);
    } else {
      // 2ème analyse et suivantes : pas de questions, que causes
      prompt = buildSecondAnalysisPrompt(
        "", // domaine vide si inutilisé
        resume,
        previousQA,
        diagnosticPrecedent,
        analyseIndex
      );
    }

    console.log("📤 Prompt envoyé à l'IA :", prompt);

    const content = await askOpenAI(prompt, description);

    console.log("📥 Réponse brute de l'IA :", content);

    // Extraction robuste du JSON dans la réponse IA
    let json;
    try {
      json = JSON.parse(content);
    } catch (e) {
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

    // Validation selon le type d'analyse
    if (analyseIndex === 1) {
      // 1ère analyse : doit contenir des questions
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
    } else {
      // 2ème analyse et suivantes : doit contenir des causes
      if (!json.causes || !Array.isArray(json.causes)) {
        throw new Error("JSON mal structuré (causes manquantes)");
      }

      return res.json({
        success: true,
        causes: json.causes,
        message: json.message || "",
      });
    }
  } catch (error) {
    console.error("❌ Erreur dans analyzeRequest :", error);
    return res.status(500).json({
      error: "Erreur lors de l'analyse.",
      details: error.message,
    });
  }
}

module.exports = {
  analyzeRequest,
};
