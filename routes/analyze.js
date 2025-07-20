const express = require("express");
const router = express.Router();
const { askOpenAI } = require("../openaiService"); // ✅ NE PAS SUPPRIMER
const { buildFirstAnalysisPrompt } = require("../utils/promptHelper"); // ✅ NE PAS SUPPRIMER
const analyzeController = require("../controllers/analyzeController"); // ✅ AJOUTÉ pour déléguer proprement

// 🔄 MODIFICATION : Délégation de la route POST vers le contrôleur
router.post("/", analyzeController.analyzeText);

module.exports = router;
