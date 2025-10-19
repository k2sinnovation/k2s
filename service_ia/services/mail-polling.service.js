// server.js - Version corrigée avec debugging
const express = require('express');
const app = express();
const mailPollingService = require('./services/mail-polling.service');
const webhookRoutes = require('./routes/webhook.routes');

// Middleware
app.use(express.json());

// ✅ Logging middleware pour déboguer les requêtes
app.use((req, res, next) => {
  console.log(`📥 ${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ✅ MONTER LES ROUTES WEBHOOK
app.use('/webhook', webhookRoutes);

// ✅ Route de santé pour vérifier que le serveur fonctionne
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    polling: {
      enabled: true,
      interval: '120 secondes'
    }
  });
});

// ✅ FONCTION DE POLLING AVEC LOGS DÉTAILLÉS
let isPolling = false; // Évite les exécutions simultanées

async function runPolling() {
  if (isPolling) {
    console.log('⏭️  Polling déjà en cours, skip...');
    return;
  }

  isPolling = true;
  const startTime = Date.now();
  
  try {
    console.log('\n🔄 ===== DÉBUT DU POLLING =====');
    console.log(`⏰ Heure: ${new Date().toISOString()}`);
    
    const result = await mailPollingService.checkAllUsers();
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Polling terminé en ${duration}s`);
    
    if (result) {
      console.log(`📊 Résultat:`, JSON.stringify(result, null, 2));
    }
    
    console.log('🔄 ===== FIN DU POLLING =====\n');
    
  } catch (err) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`\n❌ ===== ERREUR POLLING (après ${duration}s) =====`);
    console.error('Message:', err.message);
    console.error('Stack:', err.stack);
    
    // Détails supplémentaires selon le type d'erreur
    if (err.response) {
      console.error('API Response:', {
        status: err.response.status,
        data: err.response.data
      });
    }
    
    if (err.code) {
      console.error('Code erreur:', err.code);
    }
    
    console.error('❌ ===== FIN ERREUR =====\n');
  } finally {
    isPolling = false;
  }
}

// ✅ LANCER LE PREMIER POLLING IMMÉDIATEMENT AU DÉMARRAGE
console.log('🚀 Lancement du premier polling dans 5 secondes...');
setTimeout(() => {
  runPolling();
}, 5000);

// ✅ PUIS RÉPÉTER TOUTES LES 2 MINUTES
const pollingInterval = setInterval(() => {
  runPolling();
}, 120000);

// ✅ Nettoyage gracieux à l'arrêt du serveur
process.on('SIGINT', () => {
  console.log('\n⚠️  Arrêt du serveur...');
  clearInterval(pollingInterval);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⚠️  Arrêt du serveur...');
  clearInterval(pollingInterval);
  process.exit(0);
});

// ✅ Démarrer le serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n🎉 ===== SERVEUR DÉMARRÉ =====');
  console.log(`✅ Port: ${PORT}`);
  console.log(`📬 Webhook Gmail: http://localhost:${PORT}/webhook/gmail`);
  console.log(`🤖 Toggle IA: http://localhost:${PORT}/webhook/ai/toggle`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
  console.log(`🔄 Polling: Toutes les 2 minutes`);
  console.log('================================\n');
});

// ===== CONFIGURATION GOOGLE CLOUD PUB/SUB (optionnel) =====
// Pour activer les notifications Gmail push instantanées
/*
1. Créer un topic Pub/Sub dans Google Cloud Console:
   - Nom: gmail-notifications
   
2. Créer une subscription push:
   - Endpoint: https://votre-domaine.com/webhook/gmail
   
3. Donner les permissions à Gmail:
   - Dans IAM, ajouter gmail-api-push@system.gserviceaccount.com
   - Rôle: Pub/Sub Publisher
   
4. Activer le watch pour chaque utilisateur:
   POST https://gmail.googleapis.com/gmail/v1/users/me/watch
   {
     "topicName": "projects/YOUR_PROJECT_ID/topics/gmail-notifications",
     "labelIds": ["INBOX"]
   }
   
5. Gmail enverra des notifications instantanées à votre webhook
   Latence: < 1 seconde au lieu de 2 minutes !
*/

module.exports = app;
