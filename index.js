const express = require('express');
const mongoose = require('mongoose');
const OpenAI = require("openai");

const analyzeRoute = require("./routes/analyze");
const answerRoute = require("./routes/answer");
const subscribeRoute = require("./routes/subscribe");
const userRoute = require("./routes/user");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// OpenAI instance accessible globalement
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
app.locals.openai = openai;

// Connexion à MongoDB
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

// Routes principales
app.use("/api/analyze", analyzeRoute);
app.use("/api/answer", answerRoute);
app.use("/api/subscribe", subscribeRoute);
app.use("/api/user", userRoute);

// Test serveur
app.get('/', (req, res) => {
  res.send('Serveur K2S opérationnel ✅');
});

// Route directe simple pour test Postman
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
