const express = require("express");
const router = express.Router();
const { askOpenAI } = require("../controllers/openaiService");
const { buildFirstAnalysisPrompt } = require("../utils/promptBuilder");
const prompt = buildFirstAnalysisPrompt(text);
const response = await askOpenAI(prompt, text);

router.post("/", async (req, res) => {
  try {
    const { text } = req.body;

    //if (!text || text.length < 80) {
     // return res.status(400).json({ error: "Demande trop courte ou invalide." });
    //}

    res.json({ questions: response });
  } catch (error) {
    console.error("Erreur analyse :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
