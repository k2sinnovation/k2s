const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const response = await req.app.locals.openai.models.list();
    res.json(response.data);
  } catch (error) {
    console.error("Erreur API OpenAI :", error.response?.data || error.message);
    res.status(500).json({ error: "Erreur API OpenAI" });
  }
});

module.exports = router;
