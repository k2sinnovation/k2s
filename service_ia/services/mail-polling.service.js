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
    this.processedThreads = new Map(); // ✅ NOUVEAU : Cache des threads traités
    this.lastPollingStart = 0;
    this.POLLING_COOLDOWN = 30000;
  }

  async checkAllUsers() {
    const now = Date.now();
    
    if (now - this.lastPollingStart < this.POLLING_COOLDOWN) {
      const remainingTime = Math.ceil((this.POLLING_COOLDOWN - (now - this.lastPollingStart)) / 1000);
      console.log(`⏭️ [Polling] Trop tôt, attendre ${remainingTime}s`);
      return;
    }

    this.lastPollingStart = now;

    try {
      const startTime = Date.now();
      console.log('🔍 [Polling] Démarrage avec verrou timestamp:', startTime);

      const users = await User.find({
        'aiSettings.isEnabled': true,
        'aiSettings.autoReplyEnabled': true,
        'emailConfig.accessToken': { $exists: true }
      });

      if (users.length === 0) {
        console.log('ℹ️ [Polling] Aucun utilisateur actif');
        return;
      }

      console.log(`👥 [Polling] ${users.length} utilisateurs`);

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
      console.log(`✅ [Polling] Terminé (${duration}s) - ${totalSent} réponses envoyées`);

    } catch (error) {
      console.error('❌ [Polling] Erreur:', error.message);
    }
  }

  async checkUserEmails(user) {
    const userKey = user._id.toString();
    const now = Date.now();
    
    if (this.processingUsers.has(userKey)) {
      const lockTime = this.processingUsers.get(userKey);
      const elapsed = now - lockTime;
      
      if (elapsed > 300000) {
        console.log(`  ⚠️ [${user.email}] Verrou expiré (${Math.round(elapsed/1000)}s), réinitialisation`);
        this.processingUsers.delete(userKey);
      } else {
        console.log(`  ⏭️ [${user.email}] Déjà en cours (${Math.round(elapsed/1000)}s)`);
        return { processed: 0, sent: 0 };
      }
    }

    this.processingUsers.set(userKey, now);

    try {
      const newMessages = await this.fetchNewEmails(user.emailConfig, user); // ✅ Passer user en paramètre

      if (newMessages.length === 0) {
        return { processed: 0, sent: 0 };
      }

      console.log(`  📨 ${newMessages.length} nouveaux messages non lus`);

      let sent = 0;
      let alreadyProcessedCount = 0;

      for (const message of newMessages) {
        const result = await this.processMessage(message, user);
        if (result?.sent) {
          sent++;
        } else if (result?.alreadyProcessed) {
          alreadyProcessedCount++;
        }
      }

      if (alreadyProcessedCount > 0) {
        console.log(`  ⏭️ ${alreadyProcessedCount} messages déjà traités (0 token consommé)`);
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
    const BASE_URL = 'https://k2s.onrender.com';

    try {
      let response;
      let accessToken = emailConfig.accessToken;

      if (emailConfig.provider === 'gmail') {
        try {
          response = await axios.get(`${BASE_URL}/api/mail/gmail/inbox`, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
            params: {
              q: 'is:unread in:inbox'
            },
            timeout: 15000
          });
        } catch (error) {
          // ✅ Si erreur 401, tenter de rafraîchir le token
          if (error.response?.status === 401 && emailConfig.refreshToken) {
            console.log(`  🔄 [${user.email}] Token expiré, rafraîchissement...`);
            
            try {
              const refreshResponse = await axios.post(
                `${BASE_URL}/oauth/google/refresh`,
                { refresh_token: emailConfig.refreshToken },
                { timeout: 10000 }
              );

              accessToken = refreshResponse.data.access_token;
              
              // ✅ IMPORTANT : Mettre à jour le token en base
              user.emailConfig.accessToken = accessToken;
              await user.save();
              
              console.log(`  ✅ [${user.email}] Token rafraîchi avec succès`);

              // Réessayer la requête avec le nouveau token
              response = await axios.get(`${BASE_URL}/api/mail/gmail/inbox`, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
                params: {
                  q: 'is:unread in:inbox'
                },
                timeout: 15000
              });
            } catch (refreshError) {
              console.error(`  ❌ [${user.email}] Impossible de rafraîchir le token:`, refreshError.message);
              return [];
            }
          } else {
            throw error;
          }
        }
        
        const messages = response?.data?.messages || [];
        
        if (messages.length > 0) {
          console.log(`  📨 ${messages.length} messages non lus trouvés`);
        }
        
        return messages;
        
      } else if (emailConfig.provider === 'outlook') {
        response = await axios.get(`${BASE_URL}/api/mail/outlook/inbox`, {
          headers: { 'Authorization': `Bearer ${emailConfig.accessToken}` },
          timeout: 15000
        });
        
        if (response?.data?.messages) {
          const unreadMessages = response.data.messages.filter(msg => !msg.isRead);
          
          if (unreadMessages.length > 0) {
            console.log(`  📨 ${unreadMessages.length} messages non lus`);
          }
          
          return unreadMessages;
        }
      }

      return [];

    } catch (error) {
      if (error.response?.status === 429) {
        console.warn(`  ⚠️ [Quota] Limite atteinte`);
      } else {
        console.error(`  ❌ [Fetch] Erreur:`, error.message);
      }
      return [];
    }
  }

  async markAsRead(messageId, emailConfig) {
    try {
      if (emailConfig.provider === 'gmail') {
        await axios.post(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
          {
            removeLabelIds: ['UNREAD']
          },
          {
            headers: { 'Authorization': `Bearer ${emailConfig.accessToken}` },
            timeout: 10000
          }
        );
        return true;
        
      } else if (emailConfig.provider === 'outlook') {
        await axios.patch(
          `https://graph.microsoft.com/v1.0/me/messages/${messageId}`,
          {
            isRead: true
          },
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
      console.error(`    ⚠️ Impossible de récupérer l'historique:`, error.message);
      return [];
    }
  }

  async processMessage(message, user) {
    const lockKey = `${user._id}-${message.id}`;
    const now = Date.now();
    
    if (this.processingMessages.has(lockKey)) {
      const lockTime = this.processingMessages.get(lockKey);
      const elapsed = now - lockTime;
      
      if (elapsed > 120000) {
        console.log(`    ⚠️ Verrou expiré pour ${lockKey} (${Math.round(elapsed/1000)}s), réinitialisation`);
        this.processingMessages.delete(lockKey);
      } else {
        console.log(`    ⏭️ Message déjà en cours (${Math.round(elapsed/1000)}s)`);
        return { sent: false, alreadyProcessed: true };
      }
    }

    this.processingMessages.set(lockKey, now);

    try {
      // ✅ VÉRIFICATION 1 : Message déjà traité ?
      const alreadyProcessed = await AutoReply.findOne({
        userId: user._id,
        messageId: message.id,
        status: { $in: ['sent', 'pending', 'processing'] }
      });

      if (alreadyProcessed) {
        console.log(`    ⏭️ Déjà traité (${alreadyProcessed.status})`);
        await this.markAsRead(message.id, user.emailConfig);
        return { sent: false, alreadyProcessed: true };
      }

      // ✅ VÉRIFICATION 2 : Thread déjà répondu ? (éviter doublons)
      if (message.threadId) {
        const threadKey = `${user._id}-${message.threadId}`;
        
        // Vérifier cache en mémoire (rapide)
        if (this.processedThreads.has(threadKey)) {
          const lastReply = this.processedThreads.get(threadKey);
          const elapsed = now - lastReply;
          
          // Si on a répondu il y a moins de 1 heure, skip
          if (elapsed < 3600000) {
            console.log(`    ⏭️ Thread déjà répondu récemment (il y a ${Math.round(elapsed/60000)} min)`);
            await this.markAsRead(message.id, user.emailConfig);
            return { sent: false, alreadyProcessed: true };
          } else {
            // Nettoyer le cache si > 1h
            this.processedThreads.delete(threadKey);
          }
        }
        
        // Vérifier en base (sécurité)
        const threadAlreadyReplied = await AutoReply.findOne({
          userId: user._id,
          threadId: message.threadId,
          status: 'sent',
          sentAt: { $gte: new Date(Date.now() - 3600000) } // Dans la dernière heure
        }).sort({ sentAt: -1 });

        if (threadAlreadyReplied) {
          console.log(`    ⏭️ Thread déjà répondu en base (${threadAlreadyReplied.sentAt.toLocaleTimeString()})`);
          this.processedThreads.set(threadKey, threadAlreadyReplied.sentAt.getTime());
          await this.markAsRead(message.id, user.emailConfig);
          return { sent: false, alreadyProcessed: true };
        }
      }

      // ✅ CRÉER UN ENREGISTREMENT "PROCESSING" IMMÉDIATEMENT
      const processingRecord = await AutoReply.create({
        userId: user._id,
        messageId: message.id,
        threadId: message.threadId,
        from: message.from,
        subject: message.subject || '(sans objet)',
        body: message.body || message.snippet || '(en cours de récupération...)',
        status: 'processing',
        createdAt: new Date()
      });

      console.log(`    📩 Nouveau: ${message.from} - "${message.subject}"`);

      const fullMessage = await this.fetchFullMessage(message.id, user.emailConfig);
      
      if (!fullMessage) {
        console.log(`    ❌ Impossible de récupérer le message`);
        await AutoReply.deleteOne({
          userId: user._id,
          messageId: message.id,
          status: 'processing'
        });
        await this.markAsRead(message.id, user.emailConfig);
        return { sent: false, alreadyProcessed: false };
      }

      // ✅ CHARGER DONNÉES DRIVE AVANT ANALYSE
      try {
        const accessToken = user.emailConfig?.accessToken;
        
        if (accessToken) {
          let driveData = await driveCacheMiddleware.getCachedDriveData(user._id.toString());
          
          if (!driveData) {
            console.log(`  📂 [${user.email}] Chargement Drive...`);
            const driveStartTime = Date.now();
            driveData = await driveService.loadAllUserData(accessToken, user._id.toString());
            const driveDuration = Date.now() - driveStartTime;
            console.log(`  ✅ [${user.email}] Drive chargé en ${driveDuration}ms`);
            driveCacheMiddleware.cacheUserDriveData(user._id.toString(), driveData).catch(() => {});
          } else {
            console.log(`  📦 [${user.email}] Drive depuis cache`);
          }
          
          const hasBusinessInfo = !driveData.businessInfo._empty;
          const hasPlanningInfo = !driveData.planningInfo._empty;
          console.log(`  📊 [${user.email}] Drive: business=${hasBusinessInfo}, planning=${hasPlanningInfo}`);
        }
      } catch (driveError) {
        console.warn(`  ⚠️ [${user.email}] Erreur Drive (non bloquant):`, driveError.message);
      }

      // ✅ RÉCUPÉRER L'HISTORIQUE DU THREAD
      const conversationHistory = await this.getConversationHistory(
        fullMessage.threadId, 
        user.emailConfig
      );

      // Analyser le message
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

      const response = await aiService.generateResponse(
        fullMessage, 
        analysis, 
        user, 
        conversationHistory
      );

      const shouldAutoSend = user.aiSettings.autoReplyEnabled &&
                           !user.aiSettings.requireValidation &&
                           analysis.confidence >= 0.8;

      if (shouldAutoSend) {
        console.log(`    📤 Envoi réponse dans thread ${fullMessage.threadId}...`);
        
        // ✅ ENVOI EN RÉPONSE (dans le thread)
        const sendSuccess = await this.sendReply(fullMessage, response, user);

        if (!sendSuccess) {
          console.log(`    ❌ Échec envoi`);
          await AutoReply.deleteOne({
            userId: user._id,
            messageId: message.id,
            status: 'processing'
          });
          return { sent: false, alreadyProcessed: false };
        }

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

        // ✅ AJOUTER AU CACHE pour éviter doublons
        if (message.threadId) {
          const threadKey = `${user._id}-${message.threadId}`;
          this.processedThreads.set(threadKey, Date.now());
        }

        await this.markAsRead(message.id, user.emailConfig);

        console.log(`    ✅ Réponse envoyée à ${message.from}`);
        return { sent: true, alreadyProcessed: false };

      } else {
        console.log(`    ⏸️ En attente de validation`);
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
      } catch (cleanupError) {
        console.error(`    ❌ Erreur nettoyage:`, cleanupError.message);
      }
      
      try {
        await this.markAsRead(message.id, user.emailConfig);
      } catch (markError) {}
      
      return { sent: false, alreadyProcessed: false };
      
    } finally {
      this.processingMessages.delete(lockKey);
    }
  }

  async fetchFullMessage(messageId, emailConfig) {
    const BASE_URL = 'https://k2s.onrender.com';

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
    const BASE_URL = 'https://k2s.onrender.com';

    try {
      if (user.emailConfig.provider === 'gmail') {
        // ✅ IMPORTANT : Répondre dans le THREAD existant
        const response = await axios.post(`${BASE_URL}/api/mail/gmail/reply`, {
          threadId: message.threadId, // ✅ Ceci maintient la conversation
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
