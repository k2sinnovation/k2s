const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

const { Configuration, OpenAIApi } = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Init OpenAI avec ta clé d'environnement
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Connexion MongoDB avec démarrage du serveur après succès connexion
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('✅ Connexion MongoDB réussie');

  // Lancer le serveur seulement après connexion OK
  app.listen(PORT, () => {
    console.log(`Serveur lancé sur le port ${PORT}`);
  });
})
.catch((err) => {
  console.error('❌ Erreur de connexion MongoDB :', err);
  process.exit(1);  // quitte le processus si pas de connexion
});

// Route de test simple
app.get('/', (req, res) => {
  res.send('Serveur K2S opérationnel ✅');
});

// Endpoint pour tester la clé OpenAI
app.get('/test-openai', async (req, res) => {
  try {
    const response = await openai.listModels();
    res.json({ success: true, models: response.data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
});
