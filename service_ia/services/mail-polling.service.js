// service_ia/services/mail-polling.service.js
// ✅ VERSION FINALE - Ignore mark-read API, utilise DB uniquement

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
    this.POLLING_COOLDOWN = 5000;
    
    this.MAX_EMAIL_SIZE = 50000;
    this.MIN_EMAIL_INTERVAL = 60000;
    this.lastProcessedMail = new Map();
    
    this.isGlobalPollingActive = false;
    this.instanceId = `instance-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    console.log(`🆔 Instance MailPollingService créée: ${this.instanceId}`);
    
    setInterval(() => {
      const now = Date.now();
      for (const [key, timestamp] of this.processingMessages.entries()) {
        if (now - timestamp > 7200000) this.processingMessages.delete(key);
      }
      for (const [key, timestamp] of this.processedThreads.entries()) {
        if (now - timestamp > 3600000) this.processedThreads.delete(key);
      }
      for (const [key, data] of this.lastProcessedMail.entries()) {
        if (now - data.timestamp > 300000) this.lastProcessedMail.delete(key);
      }
      console.log('🧹 Cache nettoyé');
    }, 3600000);
  }

  async checkAllUsers() {
    const now = Date.now();
    
    if (this.isGlobalPollingActive) {
      console.log(`⏭️ [${this.instanceId}] Polling déjà actif, skip`);
      return { checked: 0, processed: 0, sent: 0 };
    }
    
    if (now - this.lastPollingStart < this.POLLING_COOLDOWN) {
      const remainingTime = Math.ceil((this.POLLING_COOLDOWN - (now - this.lastPollingStart)) / 1000);
      console.log(`⏭️ [${this.instanceId}] Cooldown ${remainingTime}s`);
      return { checked: 0, processed: 0, sent: 0 };
    }

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
        return { checked: 0, processed: 0, sent: 0 };
      }

      console.log(`👥 [Polling] ${users.length} utilisateur(s) actif(s)`);

      const BATCH_SIZE = 20;
      let totalProcessed = 0;
      let totalSent = 0;
      let totalFiltered = 0;

      for (let i = 0; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);
        
        const results = await Promise.allSettled(
          batch.map(user => this.checkUserEmails(user))
        );

        results.forEach(result => {
          if (result.status === 'fulfilled' && result.value) {
            totalProcessed += result.value.processed || 0;
            totalSent += result.value.sent || 0;
            totalFiltered += result.value.filtered || 0;
          }
        });
        
        if (i + BATCH_SIZE < users.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      const duration = Math.round((Date.now() - startTime) / 1000);

      console.log('\n📊 ===== RÉSUMÉ POLLING =====');
      console.log(`  ✅ Utilisateurs vérifiés: ${users.length}`);
      console.log(`  🔍 Messages filtrés: ${totalFiltered}`);
      console.log(`  📧 Messages traités: ${totalProcessed}`);
      console.log(`  ✉️  Réponses envoyées: ${totalSent}`);
      console.log(`  ⏱️  Durée: ${duration}s`);
      console.log(`  🆔 Instance: ${this.instanceId}`);
      console.log('🔄 ===== FIN POLLING =====\n');

      return { 
        checked: users.length, 
        filtered: totalFiltered,
        processed: totalProcessed, 
        sent: totalSent 
      };

    } catch (error) {
      console.error(`❌ [${this.instanceId}] Erreur critique:`, error.message);
      console.error(error.stack);
      return { checked: 0, processed: 0, sent: 0 };
    } finally {
      this.isGlobalPollingActive = false;
    }
  }

  async checkUserEmails(user) {
    const userKey = user._id.toString();
    const now = Date.now();
    
    if (this.processingUsers.has(userKey)) {
      const lockTime = this.processingUsers.get(userKey);
      const elapsed = now - lockTime;
      
      if (elapsed < 300000) {
        return { processed: 0, sent: 0, filtered: 0 };
      }
      this.processingUsers.delete(userKey);
    }

    this.processingUsers.set(userKey, now);

    try {
      // ✅ NOUVEAU: Filtrer les IDs déjà traités en base AVANT de récupérer les messages
      const newMessages = await this.fetchNewEmails(user.emailConfig, user);

      if (newMessages.length === 0) {
        return { processed: 0, sent: 0, filtered: 0 };
      }

      console.log(`  📨 [${user.email}] ${newMessages.length} nouveau(x) message(s) non lu(s)`);

      // ✅ CRITIQUE: Filtrer les messages déjà en base
      const messageIds = newMessages.map(m => m.id);
      const alreadyInDb = await AutoReply.find({
        userId: user._id,
        messageId: { $in: messageIds }
      }).select('messageId');

      const processedIds = new Set(alreadyInDb.map(r => r.messageId));
      const messagesToProcess = newMessages.filter(m => !processedIds.has(m.id));

      if (messagesToProcess.length === 0) {
        console.log(`  ⏭️ [${user.email}] Tous déjà traités`);
        return { processed: 0, sent: 0, filtered: 0 };
      }

      console.log(`  🆕 [${user.email}] ${messagesToProcess.length} nouveau(x) à analyser`);

      // Pré-charger Drive UNE FOIS
      let driveData = null;
      try {
        const accessToken = user.emailConfig?.accessToken;
        if (accessToken) {
          driveData = await driveCacheMiddleware.getCachedDriveData(userKey);
          if (!driveData) {
            driveData = await driveService.loadAllUserData(accessToken, userKey);
            driveCacheMiddleware.cacheUserDriveData(userKey, driveData).catch(() => {});
          }
        }
      } catch (driveError) {
        console.warn(`  ⚠️ Drive non disponible`);
      }

      let sent = 0;
      let filtered = 0;

      for (const message of messagesToProcess) {
        const result = await this.processMessage(message, user, driveData);
        
        if (result?.sent) {
          sent++;
        } else if (result?.filtered) {
          filtered++;
        }
      }

      if (filtered > 0) {
        console.log(`  🔍 [${user.email}] ${filtered} filtré(s)`);
      }

      return { processed: messagesToProcess.length, sent, filtered };

    } catch (error) {
      console.error(`  ❌ [${user.email}] Erreur:`, error.message);
      return { processed: 0, sent: 0, filtered: 0 };
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
            params: { 
              q: 'is:unread in:inbox',
              minimal: 'true'
            },
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
          params: { filter: 'isRead eq false' },
          timeout: 15000
        });
        
        return response?.data?.messages || [];
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
    
    // ✅ Vérifier IMMÉDIATEMENT en base (double check)
    const existsInDb = await AutoReply.findOne({
      userId: user._id,
      messageId: message.id
    });

    if (existsInDb) {
      return { sent: false, alreadyProcessed: true, filtered: false };
    }

    if (this.processingMessages.has(lockKey)) {
      return { sent: false, alreadyProcessed: true, filtered: false };
    }

    this.processingMessages.set(lockKey, now);

    try {
      const fullMessage = await this.fetchFullMessage(message.id, user.emailConfig);
      
      if (!fullMessage) {
        console.log(`    ❌ Impossible de récupérer le message`);
        return { sent: false, alreadyProcessed: false, filtered: false };
      }

      // Filtrage taille
      const bodySize = (fullMessage.body || '').length;
      if (bodySize > this.MAX_EMAIL_SIZE) {
        console.log(`    🔍 Trop volumineux (${Math.round(bodySize/1000)}KB)`);
        
        // ✅ CRÉER UN ENREGISTREMENT pour éviter re-traitement
        await AutoReply.create({
          userId: user._id,
          messageId: message.id,
          threadId: fullMessage.threadId,
          from: fullMessage.from,
          subject: fullMessage.subject || '(sans objet)',
          body: '',
          status: 'ignored',
          analysis: { isRelevant: false, reason: 'Trop volumineux', intent: 'filtered' }
        });
        
        return { sent: false, alreadyProcessed: false, filtered: true };
      }

      // Filtrage intervalle
      const lastMailKey = `${user._id}-${fullMessage.from}`;
      const lastMail = this.lastProcessedMail.get(lastMailKey);
      
      if (lastMail && (now - lastMail.timestamp) < this.MIN_EMAIL_INTERVAL) {
        const elapsed = Math.round((now - lastMail.timestamp) / 1000);
        console.log(`    🔍 Intervalle trop court (${elapsed}s)`);
        
        // ✅ CRÉER UN ENREGISTREMENT
        await AutoReply.create({
          userId: user._id,
          messageId: message.id,
          threadId: fullMessage.threadId,
          from: fullMessage.from,
          subject: fullMessage.subject || '(sans objet)',
          body: '',
          status: 'ignored',
          analysis: { isRelevant: false, reason: 'Intervalle trop court', intent: 'filtered' }
        });
        
        return { sent: false, alreadyProcessed: false, filtered: true };
      }

      // Vérification thread
      if (fullMessage.threadId) {
        const threadKey = `${user._id}-${fullMessage.threadId}`;
        
        if (this.processedThreads.has(threadKey)) {
          const lastReply = this.processedThreads.get(threadKey);
          const elapsed = now - lastReply;
          
          if (elapsed < 3600000) {
            console.log(`    ⏭️ Thread déjà répondu (${Math.round(elapsed/60000)} min)`);
            
            // ✅ CRÉER UN ENREGISTREMENT
            await AutoReply.create({
              userId: user._id,
              messageId: message.id,
              threadId: fullMessage.threadId,
              from: fullMessage.from,
              subject: fullMessage.subject || '(sans objet)',
              body: '',
              status: 'ignored',
              analysis: { isRelevant: false, reason: 'Thread déjà répondu', intent: 'duplicate' }
            });
            
            return { sent: false, alreadyProcessed: true, filtered: false };
          } else {
            this.processedThreads.delete(threadKey);
          }
        }
        
        const threadAlreadyReplied = await AutoReply.findOne({
          userId: user._id,
          threadId: fullMessage.threadId,
          status: 'sent',
          sentAt: { $gte: new Date(Date.now() - 3600000) }
        }).sort({ sentAt: -1 });

        if (threadAlreadyReplied) {
          console.log(`    ⏭️ Thread déjà répondu en base`);
          this.processedThreads.set(threadKey, threadAlreadyReplied.sentAt.getTime());
          
          // ✅ CRÉER UN ENREGISTREMENT
          await AutoReply.create({
            userId: user._id,
            messageId: message.id,
            threadId: fullMessage.threadId,
            from: fullMessage.from,
            subject: fullMessage.subject || '(sans objet)',
            body: '',
            status: 'ignored',
            analysis: { isRelevant: false, reason: 'Thread déjà répondu', intent: 'duplicate' }
          });
          
          return { sent: false, alreadyProcessed: true, filtered: false };
        }
      }

      // Créer enregistrement processing
      const processingRecord = await AutoReply.create({
        userId: user._id,
        messageId: message.id,
        threadId: fullMessage.threadId,
        from: fullMessage.from,
        subject: fullMessage.subject || '(sans objet)',
        body: fullMessage.body || fullMessage.snippet || '',
        status: 'processing',
        createdAt: new Date()
      });

      console.log(`    📩 Nouveau: ${fullMessage.from} - "${fullMessage.subject}"`);

      const conversationHistory = await this.getConversationHistory(
        fullMessage.threadId, 
        user.emailConfig
      );

      console.log(`    🤖 Analyse + Génération IA...`);
      
      const aiResult = await aiService.analyzeAndGenerateResponse(
        fullMessage, 
        user, 
        conversationHistory,
        driveData
      );

      if (!aiResult.analysis.is_relevant) {
        console.log(`    ⏭️ Non pertinent: ${aiResult.analysis.reason}`);
        processingRecord.analysis = {
          isRelevant: false,
          confidence: aiResult.analysis.confidence,
          intent: aiResult.analysis.intent,
          reason: aiResult.analysis.reason
        };
        processingRecord.status = 'ignored';
        await processingRecord.save();
        
        // ✅ PAS de tentative mark-read si 403
        this.markAsRead(message.id, user.emailConfig).catch(() => {});
        
        return { sent: false, alreadyProcessed: false, filtered: false };
      }

      console.log(`    ✅ Pertinent: ${aiResult.analysis.intent} (${(aiResult.analysis.confidence * 100).toFixed(0)}%)`);

      if (!aiResult.response || aiResult.response.trim() === '') {
        console.log(`    ⚠️ Pas de réponse générée, en attente validation`);
        
        processingRecord.analysis = {
          isRelevant: true,
          confidence: aiResult.analysis.confidence,
          intent: aiResult.analysis.intent,
          reason: aiResult.analysis.reason || 'Réponse non générée'
        };
        processingRecord.status = 'pending';
        processingRecord.generatedResponse = null;
        await processingRecord.save();
        
        return { sent: false, alreadyProcessed: false, filtered: false };
      }

      const shouldAutoSend = user.aiSettings.autoReplyEnabled &&
                           !user.aiSettings.requireValidation &&
                           aiResult.analysis.confidence >= 0.8;

      if (shouldAutoSend) {
        console.log(`    📤 Envoi réponse...`);
        
        const sendSuccess = await this.sendReply(fullMessage, aiResult.response, user);

        if (!sendSuccess) {
          console.log(`    ❌ Échec envoi`);
          
          processingRecord.analysis = {
            isRelevant: true,
            confidence: aiResult.analysis.confidence,
            intent: aiResult.analysis.intent
          };
          processingRecord.generatedResponse = aiResult.response;
          processingRecord.status = 'pending';
          processingRecord.failedAttempts = (processingRecord.failedAttempts || 0) + 1;
          processingRecord.lastError = 'Échec envoi automatique';
          await processingRecord.save();
          
          return { sent: false, alreadyProcessed: false, filtered: false };
        }

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

        // ✅ Tenter mark-read (non bloquant)
        this.markAsRead(message.id, user.emailConfig).catch(() => {});

        if (fullMessage.threadId) {
          const threadKey = `${user._id}-${fullMessage.threadId}`;
          this.processedThreads.set(threadKey, Date.now());
        }
        this.lastProcessedMail.set(`${user._id}-${fullMessage.from}`, {
          from: fullMessage.from,
          timestamp: now
        });

        console.log(`    ✅ Réponse envoyée`);
        return { sent: true, alreadyProcessed: false, filtered: false };

      } else {
        console.log(`    ⏸️ En attente validation`);
        processingRecord.analysis = {
          isRelevant: true,
          confidence: aiResult.analysis.confidence,
          intent: aiResult.analysis.intent
        };
        processingRecord.generatedResponse = aiResult.response;
        processingRecord.status = 'pending';
        await processingRecord.save();

        return { sent: false, alreadyProcessed: false, filtered: false };
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
      
      return { sent: false, alreadyProcessed: false, filtered: false };
      
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

  async markAsRead(messageId, emailConfig) {
    const BASE_URL = process.env.BASE_URL || 'https://k2s.onrender.com';

    try {
      if (emailConfig.provider === 'gmail') {
        await axios.post(`${BASE_URL}/api/mail/gmail/mark-read`, {
          messageId
        }, {
          headers: { 'Authorization': `Bearer ${emailConfig.accessToken}` },
          timeout: 10000
        });
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
      }
    } catch (error) {
      // ✅ SILENCIEUX: Pas de log si 403 (normal en attente re-auth)
    }
  }
}

module.exports = new MailPollingService();
