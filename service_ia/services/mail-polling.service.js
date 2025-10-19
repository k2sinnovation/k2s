// service_ia/services/mail-polling.service.js
// ✅ VERSION OPTIMISÉE - Analyse uniquement nouveaux messages non lus

const User = require('../models/User');
const AutoReply = require('../models/AutoReply');
const aiService = require('./ai.service');
const axios = require('axios');
const driveService = require('./google-drive.service'); 
const driveCacheMiddleware = require('../middleware/drive-cache.middleware'); 

class MailPollingService {
  constructor() {
    this.processingMessages = new Map();
    this.processingUsers = new Map();
    this.processedThreads = new Map();
    this.lastPollingStart = 0;
    this.POLLING_COOLDOWN = 30000; // 30 secondes entre chaque polling
    
    // 🧹 Nettoyage automatique du cache toutes les heures
    setInterval(() => {
      const now = Date.now();
      
      // Nettoyer messages > 2h
      for (const [key, timestamp] of this.processingMessages.entries()) {
        if (now - timestamp > 7200000) this.processingMessages.delete(key);
      }
      
      // Nettoyer threads > 1h
      for (const [key, timestamp] of this.processedThreads.entries()) {
        if (now - timestamp > 3600000) this.processedThreads.delete(key);
      }
      
      console.log('🧹 Cache nettoyé');
    }, 3600000);
  }

  async checkAllUsers() {
    const now = Date.now();
    
    // ✅ Anti-spam : respecter le cooldown
    if (now - this.lastPollingStart < this.POLLING_COOLDOWN) {
      const remainingTime = Math.ceil((this.POLLING_COOLDOWN - (now - this.lastPollingStart)) / 1000);
      console.log(`⏭️ [Polling] Cooldown ${remainingTime}s`);
      return;
    }

    this.lastPollingStart = now;

    try {
      const startTime = Date.now();
      console.log('\n🔍 [Polling] Démarrage -', new Date().toLocaleTimeString('fr-FR'));

      const users = await User.find({
        'aiSettings.isEnabled': true,
        'aiSettings.autoReplyEnabled': true,
        'emailConfig.accessToken': { $exists: true }
      });

      if (users.length === 0) {
        console.log('ℹ️ [Polling] Aucun utilisateur actif');
        return;
      }

      console.log(`👥 [Polling] ${users.length} utilisateur(s) actif(s)`);

      const BATCH_SIZE = 20;
      let totalSent = 0;

      for (let i = 0; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);
        
        const results = await Promise.allSettled(
          batch.map(user => this.checkUserEmails(user))
        );

        results.forEach(result => {
          if (result.status === 'fulfilled' && result.value?.sent) {
            totalSent += result.value.sent;
          }
        });
        
        if (i + BATCH_SIZE < users.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ [Polling] Terminé (${duration}s) - ${totalSent} réponse(s) envoyée(s)\n`);

    } catch (error) {
      console.error('❌ [Polling] Erreur:', error.message);
    }
  }

  async checkUserEmails(user) {
    const userKey = user._id.toString();
    const now = Date.now();
    
    // ✅ Vérifier si utilisateur déjà en traitement
    if (this.processingUsers.has(userKey)) {
      const lockTime = this.processingUsers.get(userKey);
      const elapsed = now - lockTime;
      
      if (elapsed > 300000) {
        console.log(`  ⚠️ [${user.email}] Verrou expiré (${Math.round(elapsed/1000)}s)`);
        this.processingUsers.delete(userKey);
      } else {
        return { processed: 0, sent: 0 };
      }
    }

    this.processingUsers.set(userKey, now);

    try {
      // 🎯 Récupérer UNIQUEMENT les messages NON LUS
      const newMessages = await this.fetchNewEmails(user.emailConfig, user);

      if (newMessages.length === 0) {
        return { processed: 0, sent: 0 };
      }

      console.log(`  📨 [${user.email}] ${newMessages.length} nouveau(x) message(s) non lu(s)`);

      let sent = 0;
      let skipped = 0;

      for (const message of newMessages) {
        const result = await this.processMessage(message, user);
        if (result?.sent) {
          sent++;
        } else if (result?.alreadyProcessed) {
          skipped++;
        }
      }

      if (skipped > 0) {
        console.log(`  ⏭️ [${user.email}] ${skipped} déjà traité(s) - 0 token utilisé`);
      }

      return { processed: newMessages.length, sent };

    } catch (error) {
      console.error(`  ❌ [${user.email}] Erreur:`, error.message);
      return { processed: 0, sent: 0 };
    } finally {
      this.processingUsers.delete(userKey);
    }
  }

  async fetchNewEmails(emailConfig, user) {
    const BASE_URL = process.env.BASE_URL || 'https://k2s.onrender.com';

    try {
      let response;
      let accessToken = emailConfig.accessToken;

      if (emailConfig.provider === 'gmail') {
        try {
          // 🎯 FILTRE CRUCIAL : is:unread in:inbox
          response = await axios.get(`${BASE_URL}/api/mail/gmail/inbox`, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
            params: {
              q: 'is:unread in:inbox' // ⭐ Seulement les NON LUS
            },
            timeout: 15000
          });
        } catch (error) {
          // ✅ Gestion token expiré
          if (error.response?.status === 401 && emailConfig.refreshToken) {
            console.log(`  🔄 [${user.email}] Token expiré, refresh...`);
            
            try {
              const refreshResponse = await axios.post(
                `${BASE_URL}/oauth/google/refresh`,
                { refresh_token: emailConfig.refreshToken },
                { timeout: 10000 }
              );

              accessToken = refreshResponse.data.access_token;
              
              // ✅ SAUVEGARDER le nouveau token
              user.emailConfig.accessToken = accessToken;
              if (refreshResponse.data.expires_in) {
                user.emailConfig.tokenExpiresAt = new Date(Date.now() + refreshResponse.data.expires_in * 1000);
              }
              await user.save();
              
              console.log(`  ✅ [${user.email}] Token rafraîchi`);

              // Réessayer avec le nouveau token
              response = await axios.get(`${BASE_URL}/api/mail/gmail/inbox`, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
                params: { q: 'is:unread in:inbox' },
                timeout: 15000
              });
            } catch (refreshError) {
              console.error(`  ❌ [${user.email}] Erreur refresh:`, refreshError.message);
              return [];
            }
          } else {
            throw error;
          }
        }
        
        const messages = response?.data?.messages || [];
        return messages;
        
      } else if (emailConfig.provider === 'outlook') {
        response = await axios.get(`${BASE_URL}/api/mail/outlook/inbox`, {
          headers: { 'Authorization': `Bearer ${emailConfig.accessToken}` },
          timeout: 15000
        });
        
        if (response?.data?.messages) {
          return response.data.messages.filter(msg => !msg.isRead);
        }
      }

      return [];

    } catch (error) {
      if (error.response?.status === 429) {
        console.warn(`  ⚠️ [${user.email}] Quota API dépassé`);
      } else if (error.code === 'ECONNABORTED') {
        console.warn(`  ⚠️ [${user.email}] Timeout`);
      } else {
        console.error(`  ❌ [${user.email}] Erreur fetch:`, error.message);
      }
      return [];
    }
  }

  async processMessage(message, user) {
    const lockKey = `${user._id}-${message.id}`;
    const now = Date.now();
    
    // ✅ Vérifier si message déjà en traitement
    if (this.processingMessages.has(lockKey)) {
      const lockTime = this.processingMessages.get(lockKey);
      const elapsed = now - lockTime;
      
      if (elapsed > 120000) {
        this.processingMessages.delete(lockKey);
      } else {
        return { sent: false, alreadyProcessed: true };
      }
    }

    this.processingMessages.set(lockKey, now);

    try {
      // ✅ VÉRIFICATION 1 : Déjà traité en base ?
      const alreadyProcessed = await AutoReply.findOne({
        userId: user._id,
        messageId: message.id,
        status: { $in: ['sent', 'pending', 'processing'] }
      });

      if (alreadyProcessed) {
        console.log(`    ⏭️ Déjà traité (${alreadyProcessed.status}) - 0 token`);
        await this.markAsRead(message.id, user.emailConfig);
        return { sent: false, alreadyProcessed: true };
      }

      // ✅ VÉRIFICATION 2 : Thread déjà répondu récemment ?
      if (message.threadId) {
        const threadKey = `${user._id}-${message.threadId}`;
        
        // Vérifier cache mémoire (rapide)
        if (this.processedThreads.has(threadKey)) {
          const lastReply = this.processedThreads.get(threadKey);
          const elapsed = now - lastReply;
          
          // Ne pas répondre 2 fois dans la même heure
          if (elapsed < 3600000) {
            console.log(`    ⏭️ Thread déjà répondu il y a ${Math.round(elapsed/60000)} min - 0 token`);
            await this.markAsRead(message.id, user.emailConfig);
            return { sent: false, alreadyProcessed: true };
          } else {
            this.processedThreads.delete(threadKey);
          }
        }
        
        // Vérifier en base
        const threadAlreadyReplied = await AutoReply.findOne({
          userId: user._id,
          threadId: message.threadId,
          status: 'sent',
          sentAt: { $gte: new Date(Date.now() - 3600000) }
        }).sort({ sentAt: -1 });

        if (threadAlreadyReplied) {
          console.log(`    ⏭️ Thread déjà répondu - 0 token`);
          this.processedThreads.set(threadKey, threadAlreadyReplied.sentAt.getTime());
          await this.markAsRead(message.id, user.emailConfig);
          return { sent: false, alreadyProcessed: true };
        }
      }

      // ✅ CRÉER L'ENREGISTREMENT EN BASE (status: processing)
      const processingRecord = await AutoReply.create({
        userId: user._id,
        messageId: message.id,
        threadId: message.threadId,
        from: message.from,
        subject: message.subject || '(sans objet)',
        body: message.body || message.snippet || '',
        status: 'processing',
        createdAt: new Date()
      });

      console.log(`    📩 Nouveau: ${message.from} - "${message.subject}"`);

      // ✅ Récupérer le message complet
      const fullMessage = await this.fetchFullMessage(message.id, user.emailConfig);
      
      if (!fullMessage) {
        console.log(`    ❌ Impossible de récupérer le message`);
        await AutoReply.deleteOne({ _id: processingRecord._id });
        await this.markAsRead(message.id, user.emailConfig);
        return { sent: false, alreadyProcessed: false };
      }

      // ✅ Charger données Drive (si disponibles)
      try {
        const accessToken = user.emailConfig?.accessToken;
        
        if (accessToken) {
          let driveData = await driveCacheMiddleware.getCachedDriveData(user._id.toString());
          
          if (!driveData) {
            console.log(`    📂 Chargement Drive...`);
            driveData = await driveService.loadAllUserData(accessToken, user._id.toString());
            driveCacheMiddleware.cacheUserDriveData(user._id.toString(), driveData).catch(() => {});
          }
        }
      } catch (driveError) {
        // Non bloquant
        console.warn(`    ⚠️ Drive non disponible:`, driveError.message);
      }

      // ✅ Récupérer l'historique du thread (contexte)
      const conversationHistory = await this.getConversationHistory(
        fullMessage.threadId, 
        user.emailConfig
      );

      // 🤖 ANALYSE IA (consomme des tokens)
      console.log(`    🤖 Analyse IA...`);
      const analysis = await aiService.analyzeMessage(fullMessage, user, conversationHistory);

      if (!analysis.is_relevant) {
        console.log(`    ⏭️ Non pertinent: ${analysis.reason}`);
        processingRecord.body = fullMessage.body;
        processingRecord.analysis = {
          isRelevant: false,
          confidence: analysis.confidence,
          intent: analysis.intent,
          reason: analysis.reason
        };
        processingRecord.status = 'ignored';
        await processingRecord.save();
        await this.markAsRead(message.id, user.emailConfig);
        return { sent: false, alreadyProcessed: false };
      }

      console.log(`    ✅ Pertinent: ${analysis.intent} (${(analysis.confidence * 100).toFixed(0)}%)`);

      // 🤖 GÉNÉRATION RÉPONSE IA (consomme des tokens)
      const response = await aiService.generateResponse(
        fullMessage, 
        analysis, 
        user, 
        conversationHistory
      );

      // ✅ Décider si envoi automatique
      const shouldAutoSend = user.aiSettings.autoReplyEnabled &&
                           !user.aiSettings.requireValidation &&
                           analysis.confidence >= 0.8;

      if (shouldAutoSend) {
        console.log(`    📤 Envoi réponse...`);
        
        const sendSuccess = await this.sendReply(fullMessage, response, user);

        if (!sendSuccess) {
          console.log(`    ❌ Échec envoi`);
          await AutoReply.deleteOne({ _id: processingRecord._id });
          return { sent: false, alreadyProcessed: false };
        }

        // ✅ Mettre à jour en base
        processingRecord.body = fullMessage.body;
        processingRecord.analysis = {
          isRelevant: true,
          confidence: analysis.confidence,
          intent: analysis.intent
        };
        processingRecord.generatedResponse = response;
        processingRecord.sentResponse = response;
        processingRecord.status = 'sent';
        processingRecord.sentAt = new Date();
        await processingRecord.save();

        // ✅ Ajouter au cache pour éviter doublon
        if (message.threadId) {
          const threadKey = `${user._id}-${message.threadId}`;
          this.processedThreads.set(threadKey, Date.now());
        }

        await this.markAsRead(message.id, user.emailConfig);

        console.log(`    ✅ Réponse envoyée`);
        return { sent: true, alreadyProcessed: false };

      } else {
        console.log(`    ⏸️ En attente validation`);
        processingRecord.body = fullMessage.body;
        processingRecord.analysis = {
          isRelevant: true,
          confidence: analysis.confidence,
          intent: analysis.intent
        };
        processingRecord.generatedResponse = response;
        processingRecord.status = 'pending';
        await processingRecord.save();

        return { sent: false, alreadyProcessed: false };
      }

    } catch (error) {
      console.error(`    ❌ Erreur traitement:`, error.message);
      
      try {
        await AutoReply.deleteOne({
          userId: user._id,
          messageId: message.id,
          status: 'processing'
        });
      } catch {}
      
      try {
        await this.markAsRead(message.id, user.emailConfig);
      } catch {}
      
      return { sent: false, alreadyProcessed: false };
      
    } finally {
      this.processingMessages.delete(lockKey);
    }
  }

  async markAsRead(messageId, emailConfig) {
    try {
      if (emailConfig.provider === 'gmail') {
        await axios.post(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
          { removeLabelIds: ['UNREAD'] },
          {
            headers: { 'Authorization': `Bearer ${emailConfig.accessToken}` },
            timeout: 10000
          }
        );
        return true;
        
      } else if (emailConfig.provider === 'outlook') {
        await axios.patch(
          `https://graph.microsoft.com/v1.0/me/messages/${messageId}`,
          { isRead: true },
          {
            headers: { 
              'Authorization': `Bearer ${emailConfig.accessToken}`,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          }
        );
        return true;
      }
      
      return false;

    } catch (error) {
      console.warn(`    ⚠️ Impossible de marquer comme lu:`, error.message);
      return false;
    }
  }

  async getConversationHistory(threadId, emailConfig) {
    try {
      if (!threadId) return [];

      const response = await axios.get(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
        {
          headers: { 'Authorization': `Bearer ${emailConfig.accessToken}` },
          timeout: 15000
        }
      );

      const messages = response?.data?.messages || [];
      
      const history = [];
      for (const msg of messages) {
        const headers = msg.payload?.headers || [];
        const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
        const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
        
        let body = '';
        const extractBody = (part) => {
          if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
            const bodyData = part.body?.data;
            if (bodyData) {
              try {
                body = Buffer.from(bodyData, 'base64').toString('utf-8');
              } catch (e) {}
            }
          }
          if (part.parts) {
            part.parts.forEach(extractBody);
          }
        };
        
        if (msg.payload) {
          extractBody(msg.payload);
        }
        
        if (!body) {
          body = msg.snippet || '';
        }

        history.push({
          from,
          subject,
          body: body.substring(0, 500),
          date: new Date(parseInt(msg.internalDate))
        });
      }

      history.sort((a, b) => a.date - b.date);

      return history;

    } catch (error) {
      return [];
    }
  }

  async fetchFullMessage(messageId, emailConfig) {
    const BASE_URL = process.env.BASE_URL || 'https://k2s.onrender.com';

    try {
      const response = await axios.get(`${BASE_URL}/api/mail/gmail/message/${messageId}`, {
        headers: { 'Authorization': `Bearer ${emailConfig.accessToken}` },
        timeout: 15000
      });

      return response?.data || null;

    } catch (error) {
      console.error(`      ❌ Erreur récupération message:`, error.message);
      return null;
    }
  }

  async sendReply(message, responseBody, user) {
    const BASE_URL = process.env.BASE_URL || 'https://k2s.onrender.com';

    try {
      if (user.emailConfig.provider === 'gmail') {
        // ✅ Répondre dans le thread (conserve la conversation)
        const response = await axios.post(`${BASE_URL}/api/mail/gmail/reply`, {
          threadId: message.threadId,
          to: message.from,
          subject: message.subject || '(sans objet)',
          body: responseBody
        }, {
          headers: { 'Authorization': `Bearer ${user.emailConfig.accessToken}` },
          timeout: 15000
        });

        return response.status === 200;
        
      } else if (user.emailConfig.provider === 'outlook') {
        const response = await axios.post(`${BASE_URL}/api/mail/outlook/reply`, {
          messageId: message.id,
          to: message.from,
          subject: message.subject || '(sans objet)',
          body: responseBody
        }, {
          headers: { 'Authorization': `Bearer ${user.emailConfig.accessToken}` },
          timeout: 15000
        });

        return response.status === 200;
      }

      return false;
      
    } catch (error) {
      console.error(`    ❌ Erreur envoi réponse:`, error.message);
      return false;
    }
  }
}

module.exports = new MailPollingService();
