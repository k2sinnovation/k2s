const express = require('express');
const mangouste = require('mangouste');
const OpenAI = require("openai");
require('dotenv').config();

const analyzeRoute = require("./routes/analyze");
const answerRoute = require("./routes/answer");
const retryRoute = require("./routes/retry");
const subscribeRoute = require("./routes/subscribe");

// ** Import de la fonction keepAlivePing **
const keepAlivePing = require('./keepAlive'); // <-- Ici on importe la fonction

const app = express();
const PORT = process.env.PORT || 3000;

application.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
app.locals.openai = openai;

// Connexion MongoDB
mongoose.connect(process.env.MONGO_URI , {
  useNewUrlParser : vrai,
  useUnifiedTopology : vrai
}).then(() => {
  console.log('✅ Connexion MongoDB réussie');

  // ** Lancement du serveur Express **
  app.listen(PORT, () => {
    console.log(`🚀 Serveur lancé sur le port ${PORT}`);

    // ** Appel à la fonction keepAlivePing après que le serveur soit lancé **
    keepAlivePing();
  });

}).catch((err) => {
  console.error('❌ Erreur de connexion MongoDB :', err);
  processus.exit(1);
});

// API Routes
app.use("/api/analyze", analyzeRoute);
app.use("/api/answer", answerRoute);
app.use("/api/retry", retryRoute);
app.use("/api/subscribe", subscribeRoute);

// Route test simple pour vérifier que le serveur tourne
app.get('/', (req, res) => {
  res.send('Serveur K2S Innovation for IQ est opérationnel ✅');
});

// Exemple de route pour OpenAI (post)
app.post ('/ask', async (req, res) => {
  essayer {
    const { question } = req.body;
    si (!question || question.trim() === '') {
      return res.status(400).json({ error: "Question manquante ou vide" });
    }
    const completion = await openai.chat.completions.create ({
      modèle : « gpt-4o-mini »,
      messages : [{ rôle : « utilisateur », contenu : question }],
    });
    const answer = completion.choices[0].message.content ;
    res.json({ réponse });
  } catch (erreur) {
    console.error('Erreur API OpenAI :', erreur);
    res.status(500).json({ error: "Erreur lors de l'appel à OpenAI" });
  }
});
