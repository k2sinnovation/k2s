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

// 🆕 Import des nouveaux modèles
const User = require('./service_ia/models/User');
const Prestation = require('./service_ia/models/Prestation');
const Appointment = require('./service_ia/models/Appointment');
const AutoReply = require('./service_ia/models/AutoReply');

// 🆕 Import nouvelle route user
const userRoute = require('./service_ia/routes/user');
// 🆕 Import route auto-reply
const autoReplyRoute = require('./service_ia/routes/autoReply');

// ✅ Import route Drive
const driveDataRoute = require('./service_ia/routes/drive-data');

// 🤖 Import du service de polling
const mailPollingService = require('./service_ia/services/mail-polling.service');

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

// ===== FONCTION DE MIGRATION =====

/**
 * 🔧 MIGRATION AUTOMATIQUE DES SUBSCRIPTIONS
 * Convertit tous les anciens formats (string) vers le nouveau format (objet)
 */
async function migrateAllSubscriptions() {
  try {
    console.log('\n🔧 [Migration] Vérification des subscriptions...');
    
    // Trouver TOUS les users avec ancien format
    const allUsers = await User.find({}).lean();
    
    console.log(`📊 [Migration] ${allUsers.length} utilisateur(s) à vérifier`);
    
    let migrated = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const user of allUsers) {
      try {
        const needsMigration = 
          typeof user.subscription === 'string' ||
          !user.subscription ||
          !user.subscription.plan;
        
        if (!needsMigration) {
          skipped++;
          continue;
        }
        
        // Déterminer le plan
        let plan = 'free';
        if (typeof user.subscription === 'string') {
          plan = user.subscription;
        } else if (user.subscription?.plan) {
          plan = user.subscription.plan;
        }
        
        // Valider le plan
        if (!['free', 'basic', 'premium', 'enterprise'].includes(plan)) {
          console.warn(`⚠️ [Migration] Plan invalide "${plan}" pour ${user.email}, défaut à free`);
          plan = 'free';
        }
        
        // ✅ MISE À JOUR DIRECTE EN BASE (bypass Mongoose defaults)
        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              'subscription.plan': plan,
              'subscription.isActive': true,
              'subscription.startDate': user.createdAt || new Date(),
              'subscription.endDate': null,
              'subscription.customQuotas': {
                dailyTokens: null,
                monthlyCalls: null,
                maxEmailsPerDay: null
              }
            }
          }
        );
        
        migrated++;
        
        const oldValue = typeof user.subscription === 'string' 
          ? `"${user.subscription}"` 
          : user.subscription 
            ? 'objet incomplet' 
            : 'undefined';
        
        console.log(`✅ [Migration] ${user.email}: ${oldValue} → { plan: "${plan}" }`);
        
      } catch (error) {
        errors++;
        console.error(`❌ [Migration] Erreur pour ${user.email}:`, error.message);
      }
    }
    
    console.log(`
╔════════════════════════════════════════╗
║  📊 MIGRATION TERMINÉE                 ║
╠════════════════════════════════════════╣
║  ✅ Migrés: ${migrated.toString().padEnd(27)}║
║  ⏭️  Déjà OK: ${skipped.toString().padEnd(25)}║
║  ❌ Erreurs: ${errors.toString().padEnd(25)}║
╚════════════════════════════════════════╝
    `);
    
    return { migrated, skipped, errors };
    
  } catch (error) {
    console.error('❌ [Migration] Erreur critique:', error);
    throw error;
  }
}

// ===== ROUTES (ORDRE CRITIQUE!) =====

// ✅ OAuth EN PREMIER (important pour les callbacks)
app.use('/', oauthGoogleRoute);
app.use('/', oauthOutlookRoute);
app.use('/api', oauthWhatsAppRoute);
app.use('/api/user', userRoute);

// Routes d'authentification
app.use('/api', authRoute);
app.use('/api', emailAccountsRoute);

// 🆕 Routes messagerie
app.use('/api/mail', mailRoutes);
app.use('/api/whatsapp', whatsappMessagingRoutes);
app.use('/api/auto-reply', autoReplyRoute);

// ✅ Route Drive
app.use('/api', driveDataRoute);

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
    version: '2.5.2',
    endpoints: {
      auth: '/api/auth/*',
      user: '/api/user/*',
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
      autoReply: {
        check: '/api/auto-reply/check/:messageId',
        checkBatch: '/api/auto-reply/check-batch',
        sent: '/api/auto-reply/sent',
        stats: '/api/auto-reply/stats',
        aiSettings: '/api/user/ai-settings',
        prestations: '/api/user/prestations',
        appointments: '/api/user/appointments',
      },
      admin: {
        migrateSubscriptions: 'POST /api/admin/migrate-subscriptions',
        checkMigrations: 'GET /api/admin/check-migrations',
        forceCheck: 'POST /api/admin/force-check',
        pollingStatus: 'GET /api/admin/polling-status',
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

// ===== ROUTES D'ADMINISTRATION =====

// 🔧 MIGRATION MANUELLE (au cas où)
app.post('/api/admin/migrate-subscriptions', async (req, res) => {
  try {
    console.log('🔧 [Admin] Migration manuelle déclenchée');
    const result = await migrateAllSubscriptions();
    
    res.json({
      success: true,
      message: `Migration terminée: ${result.migrated} utilisateur(s) migré(s)`,
      migrated: result.migrated,
      skipped: result.skipped,
      errors: result.errors
    });

  } catch (error) {
    console.error('❌ [Admin] Erreur migration:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// ✅ Vérifier l'état de la migration des subscriptions
app.get('/api/admin/check-migrations', async (req, res) => {
  try {
    const stringFormat = await User.countDocuments({ subscription: { $type: 'string' } });
    const objectFormat = await User.countDocuments({ 'subscription.plan': { $exists: true } });
    const noSubscription = await User.countDocuments({ subscription: { $exists: false } });
    const totalUsers = await User.countDocuments({});
    
    const samples = await User.find({}).limit(5).select('email subscription createdAt');
    
    const migrationComplete = stringFormat === 0 && noSubscription === 0 && objectFormat === totalUsers;
    
    res.json({
      success: true,
      migration_complete: migrationComplete,
      stats: {
        total_users: totalUsers,
        old_format_remaining: stringFormat,
        new_format: objectFormat,
        no_subscription: noSubscription,
      },
      status: migrationComplete 
        ? '✅ Migration complète - Tous les users sont au bon format'
        : '⚠️ Migration incomplète - Redémarre le serveur ou lance POST /api/admin/migrate-subscriptions',
      samples: samples.map(u => ({
        email: u.email,
        subscription: u.subscription,
        type: typeof u.subscription,
        has_plan: u.subscription?.plan ? '✅' : '❌',
        createdAt: u.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// 🧪 Forcer un check manuel (utile pour tester)
app.post('/api/admin/force-check', async (req, res) => {
  try {
    console.log('🔧 [Admin] Force check manuel déclenché');
    
    // Exécuter sans attendre
    mailPollingService.checkAllUsers().catch(err => {
      console.error('❌ Erreur force check:', err.message);
    });
    
    res.json({ 
      success: true, 
      message: 'Vérification manuelle démarrée en arrière-plan' 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🧪 Voir le statut du polling
app.get('/api/admin/polling-status', async (req, res) => {
  try {
    const timeSinceLastPoll = Date.now() - mailPollingService.lastPollingStart;
    const cooldownRemaining = Math.max(0, mailPollingService.POLLING_COOLDOWN - timeSinceLastPoll);
    
    const status = {
      lastPollingStart: mailPollingService.lastPollingStart,
      lastPollingDate: new Date(mailPollingService.lastPollingStart).toISOString(),
      timeSinceLastPoll: Math.round(timeSinceLastPoll / 1000) + 's',
      processingUsers: mailPollingService.processingUsers.size,
      processingMessages: mailPollingService.processingMessages.size,
      processedThreads: mailPollingService.processedThreads.size,
      cooldownRemaining: Math.round(cooldownRemaining / 1000) + 's',
      canPollNow: cooldownRemaining === 0,
      isGlobalPollingActive: mailPollingService.isGlobalPollingActive,
      instanceId: mailPollingService.instanceId
    };
    
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
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

// ✅ Variable globale pour éviter double polling
let autoCheckInterval = null;

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(async () => {
    console.log('✅ Connexion MongoDB réussie');
    
    // 🔧 EXÉCUTER LA MIGRATION AUTOMATIQUE AVANT TOUT
    try {
      await migrateAllSubscriptions();
    } catch (migrationError) {
      console.error('❌ Migration échouée:', migrationError);
      console.error('⚠️  Le serveur va démarrer mais risque d\'erreurs avec les quotas');
    }
    
    // Démarrer le serveur HTTP
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`
╔════════════════════════════════════════╗
║  🚀 Serveur K2S démarré avec succès   ║
╠════════════════════════════════════════╣
║  📡 Port: ${PORT.toString().padEnd(28)}║
║  🗄️  MongoDB: connecté                 ║
║  🔌 WebSocket: actif                   ║
║  🤖 Mistral AI: configuré              ║
║  🔐 OAuth: Gmail/Outlook/WhatsApp      ║
║  📧 Messagerie: Gmail/Outlook/WhatsApp ║
║  🔄 Auto-Reply: actif                  ║
║  ⚡ MODE TEST: Check toutes les 20s    ║
╚════════════════════════════════════════╝
      `);

      // 🤖 DÉMARRER LE POLLING AUTOMATIQUE (1 SEULE FOIS)
      if (!autoCheckInterval) {
        console.log('🤖 Initialisation du système d\'auto-réponse optimisé...');
        
        // ✅ Check initial après 5 secondes
        console.log('🤖 Premier check dans 5 secondes...');
        
        setTimeout(() => {
          console.log('🔍 [Initial] Démarrage premier check...');
          mailPollingService.checkAllUsers().catch(err => {
            console.error('❌ [Initial] Erreur:', err.message);
          });
        }, 5000);

        // ⏱️ INTERVAL : Toutes les 20 secondes (MODE TEST)
        autoCheckInterval = setInterval(() => {
          console.log('⏰ [AUTO] Démarrage vérification emails...');
          mailPollingService.checkAllUsers().catch(err => {
            console.error('❌ [AUTO] Erreur:', err.message);
          });
        }, 20000);

        console.log('✅ Auto-Reply optimisé activé (MODE TEST)');
        console.log('📊 Optimisations:');
        console.log('   • 1 appel Mistral au lieu de 2 (-50% tokens)');
        console.log('   • Drive chargé 1 fois pour tous les messages');
        console.log('   • Cache thread anti-doublon (1h)');
        console.log('   • Gestion quotas par plan d\'abonnement');
        console.log('   • ⚡ MODE TEST: Vérification toutes les 20 secondes');
        console.log('💡 Migrer DB: POST /api/admin/migrate-subscriptions');
        console.log('💡 Vérifier migration: GET /api/admin/check-migrations');
        console.log('💡 Forcer check: POST /api/admin/force-check');
        console.log('💡 Voir statut: GET /api/admin/polling-status');
        console.log('');
        console.log('⚠️  ATTENTION: Pense à remettre 5 minutes (300000) en production !');
        console.log('');
      }
    });
  })
  .catch((err) => {
    console.error('❌ Erreur de connexion MongoDB :', err);
    process.exit(1);
  });

// ===== GESTION ARRÊT PROPRE =====

process.on('SIGTERM', () => {
  console.log('⚠️ SIGTERM reçu, arrêt propre...');
  
  // Arrêter l'interval
  if (autoCheckInterval) {
    clearInterval(autoCheckInterval);
    console.log('✅ Auto-check arrêté');
  }
  
  server.close(() => {
    mongoose.connection.close(false, () => {
      console.log('✅ Serveur arrêté proprement');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('⚠️ SIGINT reçu, arrêt propre...');
  
  // Arrêter l'interval
  if (autoCheckInterval) {
    clearInterval(autoCheckInterval);
    console.log('✅ Auto-check arrêté');
  }
  
  server.close(() => {
    mongoose.connection.close(false, () => {
      console.log('✅ Serveur arrêté proprement');
      process.exit(0);
    });
  });
});
