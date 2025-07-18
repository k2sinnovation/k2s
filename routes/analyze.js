const express = require("express");
const router = express.Router();
const { filter } = require("../controllers/mistralService");
const { askOpenAI } = require("../controllers/openaiService");
const { loadPrompt } = require("../utils/promptHelper");
const User = require("../models/user");

router.post("/", async (req, res) => {
  const { user_id, text, type } = req.body;

  // 1. Filtrer avec Mistral
  const mistralResponse = await filter(text);
  if (mistralResponse === "rejeté") {
    return res.status(400).json({ error: "Demande hors contexte technique." });
  }

  // 2. Charger le prompt correspondant
  const promptName = type === "diagnostic" ? "prompt_diagnostic" : "prompt_choix_technique";
  const promptText = await loadPrompt(promptName);

  // 3. Appeler OpenAI
  const openAIResponse = await askOpenAI(promptText, text);

  // 4. Gérer quota, utilisateur etc (à compléter selon ta logique)

  res.json({ result: openAIResponse });
});

module.exports = router;
