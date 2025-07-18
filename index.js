const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Connexion MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Connexion MongoDB réussie'))
.catch((err) => console.error('❌ Erreur de connexion MongoDB :', err));

// Route de test
app.get('/', (req, res) => {
  res.send('Serveur K2S opérationnel ✅');
});

app.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
});
