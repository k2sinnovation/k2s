const express = require('express');
const mongoose = require('mongoose');
const OpenAI = require("openai");
const cors = require('cors');
const multer = require('multer');
const http = require('http');

require('dotenv').config();

// ✅ Import des services
const { processAudio, streamGoogleTTS } = require('./controllers/assemblyService');
const { promptTTSVocal } = require('./utils/promptsTTSVocal');
const { router: openaiWebhookRouter } = require('./openaiWebhookService');
const { wss, attachWebSocketToServer, clients, sendToFlutter } = require('./websocket');

// ✅ Import des routes existantes
const analyzeRoute = require("./routes/analyze");
const answerRoute = require("./routes/answer");
const subscribeRoute = require("./routes/subscribe");
const assemblyRoute = require('./routes/assembly');
const testAudioRoutes = require('./routes/testAudio');
const testTTSRoutes = require('./routes/testTTS');
const testTtsRouter = require('./controllers/test_google_tts');

// ✅ Import des routes authentification
const authRoute = require('./service_ia/routes/auth');
const emailAccountsRoute = require('./service_ia/routes/emailTokens'); 
const oauthWhatsAppRoute = require('./service_ia/routes/oauthWhatsApp');
const oauthGoogleRoute = require('./service_ia/routes/oauthGoogle');
const oauthOutlookRoute = require('./service_ia/routes/oauthOutlook');

// 🆕 Import des nouvelles routes messagerie
const mailRoutes = require('./service_ia/routes/mail');
const whatsappMessagingRoutes = require('./service_ia/routes/whatsapp');

// ===== CONFIGURATION =====

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Multer pour upload de fichiers
const upload = multer({ dest: 'uploads/' });

// ===== MIDDLEWARE (ORDRE IMPORTANT!) =====

// 1️⃣ CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-WhatsApp-Token'],
  credentials: true,
}));

// 2️⃣ Parser JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 3️⃣ Logs des requêtes
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.path}`);
  next();
});

// 4️⃣ Fichiers statiques
app.use('/uploads', express.static('uploads'));

// ===== OPENAI =====

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
app.locals.openai = openai;

// ===== WEBSOCKET =====

const server = http.createServer(app);
attachWebSocketToServer(server, openai);

// Rendre WebSocket accessible pour les routes
app.set('wss', wss);
app.set('wsClients', clients);
app.set('sendToFlutter', sendToFlutter);

// Keepalive WebSocket
setInterval(() => {
  clients.forEach((client, deviceId) => {
    if (client.ws.readyState === 1) {
      client.ws.ping('keepalive');
    }
  });
}, 15000);

// ===== ROUTES (ORDRE CRITIQUE!) =====

// ✅ OAuth EN PREMIER (important pour les callbacks)
app.use('/', oauthGoogleRoute);
app.use('/', oauthOutlookRoute);
app.use('/api', oauthWhatsAppRoute);

// Routes d'authentification
app.use('/api', authRoute);
app.use('/api', emailAccountsRoute);

// 🆕 NOUVELLES ROUTES MESSAGERIE
app.use('/api/mail', mailRoutes);
app.use('/api/whatsapp', whatsappMessagingRoutes);

// Routes webhook OpenAI
app.use('/openai-webhook', openaiWebhookRouter);

// Routes métier existantes
app.use("/api/analyze", analyzeRoute);
app.use("/api/answer", answerRoute);
app.use("/api/subscribe", subscribeRoute);
app.use('/api/assembly', assemblyRoute);
app.use('/api', testAudioRoutes);
app.use('/api', testTTSRoutes);
app.use('/test-tts', testTtsRouter);

// ===== ROUTES DE TEST =====

// Route racine
app.get('/', (req, res) => {
  res.json({
    message: 'Serveur K2S Innovation for IQ est opérationnel ✅',
    version: '2.1.0',
    endpoints: {
      auth: '/api/auth/*',
      email: '/api/auth/email-accounts',
      oauth: {
        gmail: '/oauth/google/callback',
        outlook: '/auth/outlook/info',
        whatsapp: '/api/auth/whatsapp/*',
      },
      messaging: {
        gmail: '/api/mail/gmail/*',
        outlook: '/api/mail/outlook/*',
        whatsapp: '/api/whatsapp/*',
      },
      analyze: '/api/analyze',
      answer: '/api/answer',
      subscribe: '/api/subscribe',
    },
  });
});

// Liste des modèles OpenAI
app.get('/api/listModels', async (req, res) => {
  try {
    const response = await openai.models.list();
    res.json(response.data);
  } catch (error) {
    console.error("❌ Erreur API OpenAI :", error.response?.data || error.message);
    res.status(500).json({ error: "Erreur API OpenAI" });
  }
});

// Test direct OpenAI
app.post('/api/ask', async (req, res) => {
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
    console.error('❌ Erreur API OpenAI :', error);
    res.status(500).json({ 
      error: "Erreur lors de l'appel à OpenAI",
      details: error.message 
    });
  }
});

// ===== GESTION D'ERREURS =====

// Route 404
app.use((req, res) => {
  res.status(404).json({
    error: 'Route non trouvée',
    path: req.path,
    method: req.method,
  });
});

// Gestionnaire d'erreurs global
app.use((err, req, res, next) => {
  console.error('❌ Erreur serveur:', err);
  
  res.status(err.status || 500).json({
    error: err.message || 'Erreur interne du serveur',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// ===== DÉMARRAGE SERVEUR =====

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => {
    console.log('✅ Connexion MongoDB réussie');
    
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`
╔════════════════════════════════════════╗
║  🚀 Serveur K2S démarré avec succès   ║
╠════════════════════════════════════════╣
║  📡 Port: ${PORT.toString().padEnd(28)}║
║  🗄️  MongoDB: connecté                 ║
║  🔌 WebSocket: actif                   ║
║  🤖 OpenAI: configuré                  ║
║  🔐 OAuth: Gmail/Outlook/WhatsApp      ║
║  📧 Messagerie: Gmail/Outlook/WhatsApp ║
╚════════════════════════════════════════╝
      `);
    });
  })
  .catch((err) => {
    console.error('❌ Erreur de connexion MongoDB :', err);
    process.exit(1);
  });

// ===== GESTION ARRÊT PROPRE =====

process.on('SIGTERM', () => {
  console.log('⚠️ SIGTERM reçu, arrêt propre...');
  server.close(() => {
    mongoose.connection.close(false, () => {
      console.log('✅ Serveur arrêté proprement');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('⚠️ SIGINT reçu, arrêt propre...');
  server.close(() => {
    mongoose.connection.close(false, () => {
      console.log('✅ Serveur arrêté proprement');
      process.exit(0);
    });
  });
});
