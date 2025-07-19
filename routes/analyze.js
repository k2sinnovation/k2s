const express = require("express");
const router = express.Router();
const { askOpenAI } = require("../controllers/openaiService");
const { loadPrompt } = require("../utils/promptHelper");
const User = require("../models/usermodel");

router.post("/", async (req, res) => {
  try {
    const { user_id, text } = req.body;

    // 1. Vérification minimum (optionnelle si déjà filtrée dans Flutter)
    //if (!text || text.length < 80) {
    //  return res.status(400).json({ error: "Demande trop courte ou invalide." });
   // }

    // 2. Charger le prompt unique (à créer/fusionner)
    const promptText = await loadPrompt("prompt_technique_global"); // ex: prompts/prompt_technique_global.txt

    // 3. Appeler OpenAI pour générer 5 questions
    const openAIResponse = await askOpenAI(promptText, text);

    // 4. (Optionnel) mettre à jour le quota utilisateur ici

    // 5. Retourner les questions générées
    res.json({ questions: openAIResponse });
  } catch (error) {
    console.error("Erreur analyse :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
