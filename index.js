const express = require('express');
const mongoose = require('mongoose');
const OpenAI = require("openai");
require('dotenv').config(); // Ajouté au cas où ce n’est pas fait ailleurs

// Routes et modèles
const analyzeRoute = require("./routes/analyze");   // Corrigé le chemin (./ au lieu de ../)
const answerRoute = require("./routes/answer");
const subscribeRoute = require("./routes/subscribe");
const retryRoute = require("./routes/retry");
const userRoute = require("./models/usermodel");         // <-- À vérifier : usermodel = modèle, ici c’est une route ?

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ✅ Instance OpenAI accessible globalement
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
app.locals.openai = openai;

// ✅ Connexion MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('✅ Connexion MongoDB réussie');
  app.listen(PORT, () => {
    console.log(`🚀 Serveur lancé sur le port ${PORT}`);
  });
})
.catch((err) => {
  console.error('❌ Erreur de connexion MongoDB :', err);
  process.exit(1);
});

// ✅ Routes principales
app.use("/api/analyze", analyzeRoute);
app.use("/api/answer", answerRoute);
app.use("/api/subscribe", subscribeRoute);
app.use("/api/user", userRoute); // ← Si userRoute est un modèle, ce n’est pas nécessaire ici
app.use("/api/retry", retryRoute);

// ✅ Route test GET
app.get('/', (req, res) => {
  res.send('Serveur K2S Innovation for IQ est opérationnel ✅');
});

// ✅ Test direct OpenAI
app.post('/ask', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || question.trim() === '') {
      return res.status(400).json({ error: "Question manquante ou vide" });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: question }],
    });

    const answer = completion.choices[0].message.content;
    res.json({ answer });
  } catch (error) {
    console.error('Erreur API OpenAI :', error);
    res.status(500).json({ error: "Erreur lors de l'appel à OpenAI" });
  }
});
