const express = require('express');
const router = express.Router();
const analyzeController = require('../controllers/analyzeController'); // ✅ Chemin correct

router.post('/', analyzeController.analyzeText); // ✅ On appelle bien la fonction du contrôleur

module.exports = router;
