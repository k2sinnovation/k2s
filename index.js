const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

const { Configuration, OpenAIApi } = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('✅ Connexion MongoDB réussie');

  app.listen(PORT, () => {
    console.log(`Serveur lancé sur le port ${PORT}`);
  });
})
.catch((err) => {
  console.error('❌ Erreur de connexion MongoDB :', err);
  process.exit(1);
});

// Route test simple
app.get('/', (req, res) => {
  res.send('Serveur K2S opérationnel ✅');
});

// Exemple route POST pour interroger OpenAI
app.post('/ask', async (req, res) => {
  try {
    const question = req.body.question;
    if (!question) return res.status(400).json({ error: "Question manquante" });

    const completion = await openai.createChatCompletion({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: question }],
    });

    const answer = completion.data.choices[0].message.content;
    res.json({ answer });
  } catch (error) {
    console.error('Erreur API OpenAI :', error);
    res.status(500).json({ error: "Erreur lors de l'appel à OpenAI" });
  }
});
