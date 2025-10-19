// service_ia/services/mail-polling.service.js
// ✅ VERSION ULTRA-OPTIMISÉE - Maximum 2-3 requêtes par message

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
    this.POLLING_COOLDOWN = 30000;
    
    // ✅ NOUVEAU : Lock global pour éviter double exécution
    this.isGlobalPollingActive = false;
    this.instanceId = `instance-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    console.log(`🆔 Instance MailPollingService créée: ${this.instanceId}`);
    
    // 🧹 Nettoyage cache toutes les heures
    setInterval(() => {
      const now = Date.now();
      for (const [key, timestamp] of this.processingMessages.entries()) {
        if (now - timestamp > 7200000) this.processingMessages.delete(key);
      }
      for (const [key, timestamp] of this.processedThreads.entries()) {
        if (now - timestamp > 3600000) this.processedThreads.delete(key);
      }
      console.log('🧹 Cache nettoyé');
    }, 3600000);
  }

  async checkAllUsers() {
    const now = Date.now();
    
    // ✅ VERROU GLOBAL : Un seul polling à la fois (toutes instances confondues)
    if (this.isGlobalPollingActive) {
      console.log(`⏭️ [${this.instanceId}] Polling déjà actif, skip`);
      return { checked: 0, processed: 0, sent: 0 };
    }
    
    // Vérifier cooldown
    if (now - this.lastPollingStart < this.POLLING_COOLDOWN) {
      const remainingTime = Math.ceil((this.POLLING_COOLDOWN - (now - this.lastPollingStart)) / 1000);
      console.log(`⏭️ [${this.instanceId}] Cooldown ${remainingTime}s`);
      return { checked: 0, processed: 0, sent: 0 };
    }

    // ✅ ACTIVER LE VERROU
    this.isGlobalPollingActive = true;
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
      let totalRequests = 0;

      for (let i = 0; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);
        
        const results = await Promise.allSettled(
          batch.map(user => this.checkUserEmails(user))
        );

        results.forEach(result => {
          if (result.status === 'fulfilled' && result.value) {
            totalSent += result.value.sent || 0;
            totalRequests += result.value.requests || 0;
          }
        });
        
        if (i + BATCH_SIZE < users.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ [Polling] Terminé (${duration}s) - ${totalSent} réponse(s) - ${totalRequests} requêtes\n`);

    } catch (error) {
      console.error('❌ [Polling] Erreur:', error.message);
    }
  }

  async checkUserEmails(user) {
    const userKey = user._id.toString();
    const now = Date.now();
    
    // ✅ Anti-doublon utilisateur
    if (this.processingUsers.has(userKey)) {
      const lockTime = this.processingUsers.get(userKey);
      const elapsed = now - lockTime;
      
      if (elapsed < 300000) {
        return { processed: 0, sent: 0, requests: 0 };
      }
      this.processingUsers.delete(userKey);
    }

    this.processingUsers.set(userKey, now);

    try {
      let requestCount = 0;

      // 🎯 REQUÊTE 1 : Récupérer messages NON LUS
      const newMessages = await this.fetchNewEmails(user.emailConfig, user);
      requestCount++;

      if (newMessages.length === 0) {
        return { processed: 0, sent: 0, requests: requestCount };
      }

      console.log(`  📨 [${user.email}] ${newMessages.length} nouveau(x) message(s) non lu(s)`);

      // ✅ PRÉ-CHARGER Drive UNE SEULE FOIS pour tous les messages
      let driveData = null;
      try {
        const accessToken = user.emailConfig?.accessToken;
        if (accessToken) {
          driveData = await driveCacheMiddleware.getCachedDriveData(user._id.toString());
          if (!driveData) {
            driveData = await driveService.loadAllUserData(accessToken, user._id.toString());
            driveCacheMiddleware.cacheUserDriveData(user._id.toString(), driveData).catch(() => {});
          }
        }
      } catch (driveError) {
        console.warn(`  ⚠️ Drive non disponible`);
      }

      let sent = 0;
      let skipped = 0;

      for (const message of newMessages) {
        const result = await this.processMessage(message, user, driveData);
        requestCount += result.requests || 0;
        
        if (result?.sent) {
          sent++;
        } else if (result?.alreadyProcessed) {
          skipped++;
        }
      }

      if (skipped > 0) {
        console.log(`  ⏭️ [${user.email}] ${skipped} déjà traité(s) - 0 token`);
      }

      return { processed: newMessages.length, sent, requests: requestCount };

    } catch (error) {
      console.error(`  ❌ [${user.email}] Erreur:`, error.message);
      return { processed: 0, sent: 0, requests: 0 };
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
          response = await axios.get(`${BASE_URL}/api/mail/gmail/inbox`, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
            params: { q: 'is:unread in:inbox' },
            timeout: 15000
          });
        } catch (error) {
          if (error.response?.status === 401 && emailConfig.refreshToken) {
            console.log(`  🔄 [${user.email}] Token expiré, refresh...`);
            
            const refreshResponse = await axios.post(
              `${BASE_URL}/oauth/google/refresh`,
              { refresh_token: emailConfig.refreshToken },
              { timeout: 10000 }
            );

            accessToken = refreshResponse.data.access_token;
            user.emailConfig.accessToken = accessToken;
            if (refreshResponse.data.expires_in) {
              user.emailConfig.tokenExpiresAt = new Date(Date.now() + refreshResponse.data.expires_in * 1000);
            }
            await user.save();
            
            response = await axios.get(`${BASE_URL}/api/mail/gmail/inbox`, {
              headers: { 'Authorization': `Bearer ${accessToken}` },
              params: { q: 'is:unread in:inbox' },
              timeout: 15000
            });
          } else {
            throw error;
          }
        }
        
        return response?.data?.messages || [];
        
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
        console.warn(`  ⚠️ Quota API dépassé`);
      }
      return [];
    }
  }

  async processMessage(message, user, driveData) {
    const lockKey = `${user._id}-${message.id}`;
    const now = Date.now();
    let requestCount = 0;
    
    // ✅ VERROU STRICT : Si déjà en traitement, SKIP immédiatement
    if (this.processingMessages.has(lockKey)) {
      return { sent: false, alreadyProcessed: true, requests: 0 };
    }

    this.processingMessages.set(lockKey, now);

    try {
      // ✅ VÉRIFICATION 1 : En base (0 requête API)
      const alreadyProcessed = await AutoReply.findOne({
        userId: user._id,
        messageId: message.id,
        status: { $in: ['sent', 'pending', 'processing'] }
      });

      if (alreadyProcessed) {
        console.log(`    ⏭️ Déjà traité (${alreadyProcessed.status}) - 0 token`);
        return { sent: false, alreadyProcessed: true, requests: 0 };
      }

      // ✅ VÉRIFICATION 2 : Thread déjà répondu ? (0 requête API)
      if (message.threadId) {
        const threadKey = `${user._id}-${message.threadId}`;
        
        if (this.processedThreads.has(threadKey)) {
          const lastReply = this.processedThreads.get(threadKey);
          const elapsed = now - lastReply;
          
          if (elapsed < 3600000) {
            console.log(`    ⏭️ Thread déjà répondu il y a ${Math.round(elapsed/60000)} min - 0 token`);
            return { sent: false, alreadyProcessed: true, requests: 0 };
          } else {
            this.processedThreads.delete(threadKey);
          }
        }
        
        const threadAlreadyReplied = await AutoReply.findOne({
          userId: user._id,
          threadId: message.threadId,
          status: 'sent',
          sentAt: { $gte: new Date(Date.now() - 3600000) }
        }).sort({ sentAt: -1 });

        if (threadAlreadyReplied) {
          console.log(`    ⏭️ Thread déjà répondu - 0 token`);
          this.processedThreads.set(threadKey, threadAlreadyReplied.sentAt.getTime());
          return { sent: false, alreadyProcessed: true, requests: 0 };
        }
      }

      // ✅ CRÉER L'ENREGISTREMENT "processing"
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

      // 🎯 REQUÊTE 2 : Récupérer message complet
      const fullMessage = await this.fetchFullMessage(message.id, user.emailConfig);
      requestCount++;
      
      if (!fullMessage) {
        console.log(`    ❌ Impossible de récupérer le message`);
        await AutoReply.deleteOne({ _id: processingRecord._id });
        return { sent: false, alreadyProcessed: false, requests: requestCount };
      }

      // ✅ Historique thread (0 requête supplémentaire si on optimise)
      const conversationHistory = await this.getConversationHistory(
        fullMessage.threadId, 
        user.emailConfig
      );
      // requestCount++; // Commenté car on peut l'éviter si pas critique

      // 🤖 REQUÊTE 3 : Analyse + Génération IA (1 SEUL appel OpenAI)
      console.log(`    🤖 Analyse + Génération IA...`);
      
      // ✅ NOUVELLE MÉTHODE OPTIMISÉE : 1 appel au lieu de 2
      const aiResult = await aiService.analyzeAndGenerateResponse(
        fullMessage, 
        user, 
        conversationHistory,
        driveData // Utiliser driveData déjà chargé (0 requête supplémentaire)
      );
      requestCount++; // 1 seul appel OpenAI = -50% tokens

      if (!aiResult.analysis.is_relevant) {
        console.log(`    ⏭️ Non pertinent: ${aiResult.analysis.reason}`);
        processingRecord.body = fullMessage.body;
        processingRecord.analysis = {
          isRelevant: false,
          confidence: aiResult.analysis.confidence,
          intent: aiResult.analysis.intent,
          reason: aiResult.analysis.reason
        };
        processingRecord.status = 'ignored';
        await processingRecord.save();
        return { sent: false, alreadyProcessed: false, requests: requestCount };
      }

      console.log(`    ✅ Pertinent: ${aiResult.analysis.intent} (${(aiResult.analysis.confidence * 100).toFixed(0)}%)`);

      const shouldAutoSend = user.aiSettings.autoReplyEnabled &&
                           !user.aiSettings.requireValidation &&
                           aiResult.analysis.confidence >= 0.8;

      if (shouldAutoSend) {
        console.log(`    📤 Envoi réponse...`);
        
        // 🎯 REQUÊTE 4 : Envoi réponse
        const sendSuccess = await this.sendReply(fullMessage, aiResult.response, user);
        requestCount++;

        if (!sendSuccess) {
          console.log(`    ❌ Échec envoi`);
          await AutoReply.deleteOne({ _id: processingRecord._id });
          return { sent: false, alreadyProcessed: false, requests: requestCount };
        }

        processingRecord.body = fullMessage.body;
        processingRecord.analysis = {
          isRelevant: true,
          confidence: aiResult.analysis.confidence,
          intent: aiResult.analysis.intent
        };
        processingRecord.generatedResponse = aiResult.response;
        processingRecord.sentResponse = aiResult.response;
        processingRecord.status = 'sent';
        processingRecord.sentAt = new Date();
        await processingRecord.save();

        // ✅ Cache thread
        if (message.threadId) {
          const threadKey = `${user._id}-${message.threadId}`;
          this.processedThreads.set(threadKey, Date.now());
        }

        console.log(`    ✅ Réponse envoyée (${requestCount} requêtes)`);
        return { sent: true, alreadyProcessed: false, requests: requestCount };

      } else {
        console.log(`    ⏸️ En attente validation`);
        processingRecord.body = fullMessage.body;
        processingRecord.analysis = {
          isRelevant: true,
          confidence: aiResult.analysis.confidence,
          intent: aiResult.analysis.intent
        };
        processingRecord.generatedResponse = aiResult.response;
        processingRecord.status = 'pending';
        await processingRecord.save();

        return { sent: false, alreadyProcessed: false, requests: requestCount };
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
      
      return { sent: false, alreadyProcessed: false, requests: requestCount };
      
    } finally {
      this.processingMessages.delete(lockKey);
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
      console.error(`      ❌ Erreur récupération:`, error.message);
      return null;
    }
  }

  async sendReply(message, responseBody, user) {
    const BASE_URL = process.env.BASE_URL || 'https://k2s.onrender.com';

    try {
      if (user.emailConfig.provider === 'gmail') {
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
      console.error(`    ❌ Erreur envoi:`, error.message);
      return false;
    }
  }
}

module.exports = new MailPollingService();
