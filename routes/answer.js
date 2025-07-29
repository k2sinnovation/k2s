const express = require("express");
const router = express.Router();
const { askOpenAI } = require("../controllers/openaiService");
const { buildFirstAnalysisPrompt } = require("../utils/promptBuilder");
const { buildSecondAnalysisPrompt } = require("../utils/promptBuilder");

router.post('/', async (req, res) => {
const { text, answers, analyseIndex } = req.body;
  console.log(`Réception d’une réponse pour l’analyse n°${analyseIndex || "?"}`);
  
  
  if (!text || !answers || typeof answers !== 'object') {
    return res.status(400).json({ error: "Paramètres manquants ou invalides" });
  }

  try {
    // Conversion answers (objet) en tableau [{ question, reponse }]
    const qaArray = Object.entries(answers).map(([question, reponse]) => ({
      question,
      reponse,
    }));
    
    console.log("Questions/Réponses reçues:", qaArray);
    
    const domaine = "ton domaine ici"; // adapte selon contexte ou passe en paramètre
    const resume = "Résumé précédent ici ou vide";

   const prompt = buildSecondAnalysisPrompt(resume, qaArray, domaine);

    const aiResponse = await askOpenAI(prompt, text);
    res.json({ result: aiResponse });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors du traitement de la requête" });
  }
});
module.exports = router;
