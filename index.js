const express = require('express');
const mongoose = require('mongoose');
const OpenAI = require("openai");
const { generateTTS } = require('./controllers/openaiService'); // à créer pour la génération vocale
require('dotenv').config();

//APPELER LE RECORD TRANSCRIBE AUDIO WHITER

const multer = require('multer');
const upload = multer({ dest: 'uploads/' }); // dossier temporaire pour fichiers uploadés
const { transcribeAudio, askOpenAI } = require('./controllers/openaiService');


// ✅ Chargement des routes
const analyzeRoute = require("./routes/analyze");
const answerRoute = require("./routes/answer");
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

//APPEL WHISPER OPENIA POUR LE VOCAL 
//GESTION APPEL TTS VOCAL 
app.post('/api/whisper-gpt', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Fichier audio manquant" });
    }

    // Transcription Whisper
    const texte = await transcribeAudio(req.file.path);

    if (!texte || texte.trim() === '') {
      return res.status(204).send();
    }

    // Génération réponse GPT
    const promptSystem = "Tu es un assistant expert qui répond de façon claire et précise.";
    const reponse = await askOpenAI(promptSystem, texte);

    // Génération vocal TTS de la réponse GPT
    const audioBuffer = await generateTTS(reponse);

    // Logs utiles
    console.log("Transcription :", texte);
    console.log("Réponse GPT :", reponse);
    console.log("Buffer audio TTS généré, taille :", audioBuffer.length);

    // Retourne transcription, réponse texte, et audio encodé en base64
    res.json({
      texte,
      reponse,
      audioBase64: audioBuffer.toString('base64'),
    });

  } catch (error) {
    console.error("Erreur dans /api/whisper-gpt :", error);
    res.status(500).json({ error: error.message || "Erreur serveur" });
  }
});



// ✅ Routes correctement montées avec "/api" !
app.use("/api/analyze", analyzeRoute);
app.use("/api/answer", answerRoute);
app.use("/api/subscribe", subscribeRoute);

// ✅ Route pour lister les modèles accessibles via l'API OpenAI
app.get('/api/istModels', async (req, res) => {
  try {
    const response = await openai.models.list();
    res.json(response.data);
  } catch (error) {
    console.error("Erreur API OpenAI :", error.response?.data || error.message);
    res.status(500).json({ error: "Erreur API OpenAI" });
  }
});


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
      model: "chatgpt-4o-latest",
      messages: [{ role: "user", content: question }],
    });

    const answer = completion.choices[0].message.content;
    res.json({ answer });
  } catch (error) {
    console.error('Erreur API OpenAI :', error);
    res.status(500).json({ error: "Erreur lors de l'appel à OpenAI" });
  }
});
