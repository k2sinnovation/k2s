const express = require('express');
const mongoose = require('mongoose');
const OpenAI = require("openai");
const fs = require('fs');
const { processAudio, streamGoogleTTS } = require('./controllers/assemblyService');
const { promptTTSVocal } = require('./utils/promptsTTSVocal');
const assemblyRoute = require('./routes/assembly');
const testAudioRoutes = require('./routes/testAudio');
const testTTSRoutes = require('./routes/testTTS');
const testTtsRouter = require('./controllers/test_google_tts');

require('dotenv').config();

const multer = require('multer');
const upload = multer({ dest: 'uploads/' }); // dossier temporaire

// ✅ Chargement des routes
const analyzeRoute = require("./routes/analyze");
const answerRoute = require("./routes/answer");
const subscribeRoute = require("./routes/subscribe");

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

// ✅ OpenAI initialisé
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
app.locals.openai = openai;

// ✅ WebSocket
const http = require('http');
const { attachWebSocketToServer } = require('./websocket'); // Import fonction

// Crée serveur HTTP pour attacher Express + WebSocket
const server = http.createServer(app);

// Attache WebSocket au serveur HTTP (une seule fois)
attachWebSocketToServer(server);



// ✅ Connexion MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ Connexion MongoDB réussie');
  server.listen(PORT, () => {
    console.log(`🚀 Serveur HTTP + WebSocket lancé sur le port ${PORT}`);
  });
}).catch((err) => {
  console.error('❌ Erreur de connexion MongoDB :', err);
  process.exit(1);
});

// ✅ Routes correctement montées avec "/api" !
app.use("/api/analyze", analyzeRoute);
app.use("/api/answer", answerRoute);
app.use("/api/subscribe", subscribeRoute);
app.use('/api', testAudioRoutes);
app.use('/uploads', express.static('uploads'));
app.use('/api', testTTSRoutes);
app.use('/api/assembly', assemblyRoute);
app.use('/test-tts', testTtsRouter);

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
      model: "gpt-5-mini",
      messages: [{ role: "user", content: question }],
    });

    const answer = completion.choices[0].message.content;
    res.json({ answer });
  } catch (error) {
    console.error('Erreur API OpenAI :', error);
    res.status(500).json({ error: "Erreur lors de l'appel à OpenAI" });
  }
});
