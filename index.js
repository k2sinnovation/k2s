const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Connexion MongoDB avec démarrage du serveur **après** succès connexion
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

// Route de test
app.get('/', (req, res) => {
  res.send('Serveur K2S opérationnel ✅');
});
