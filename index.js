const express = require('express');
const mongoose = require('mongoose');
const OpenAI = require("openai");
require('dotenv').config();

// ✅ Chargement des routes
const analyzeRoute = require("./routes/analyze");
const answerRoute = require("./routes/answer");
const retryRoute = require("./routes/retry");
const subscribeRoute = require("./routes/subscribe");

// ⚠️ Ce n’est pas une route à utiliser comme tel, sauf si tu l’as défini dans /models comme un vrai routeur
// const userRoute = require("./models/usermodel");

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

// ✅ OpenAI initialisé
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
app.locals.openai = openai;

// ✅ Connexion MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ Connexion MongoDB réussie');
  app.listen(PORT, () => {
    console.log(`🚀 Serveur lancé sur le port ${PORT}`);
  });
}).catch((err) => {
  console.error('❌ Erreur de connexion MongoDB :', err);
  process.exit(1);
});

// ✅ Routes correctement montées avec "/api" !
app.use("/api/analyze", analyzeRoute);
app.use("/api/answer", answerRoute);
app.use("/api/retry", retryRoute);
app.use("/api/subscribe", subscribeRoute);

// ❌ Retiré car usermodel n’est pas une route
// app.use("/api/user", userRoute);

// ✅ Test route GET
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
      model: "gpt-4-turbo",
      messages: [{ role: "user", content: question }],
    });

    const answer = completion.choices[0].message.content;
    res.json({ answer });
  } catch (error) {
    console.error('Erreur API OpenAI :', error);
    res.status(500).json({ error: "Erreur lors de l'appel à OpenAI" });
  }
});
