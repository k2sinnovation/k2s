// service_ia/services/mail-polling.service.js
// ✅ VERSION AVEC LOGIQUE INTELLIGENTE DE THREAD + FIX RÉPONSES GMAIL + GESTION QUOTAS

const User = require('../models/User');
const AutoReply = require('../models/AutoReply');
const aiService = require('../services/ai.service');
const quotaService = require('../quota.service'); // ✅ AJOUT
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
      let totalQuotaBlocked = 0; // ✅ AJOUT

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
            totalQuotaBlocked += result.value.quotaBlocked || 0; // ✅ AJOUT
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
      console.log(`  🚫 Bloqués (quota): ${totalQuotaBlocked}`); // ✅ AJOUT
      console.log(`  ⏱️  Durée: ${duration}s`);
      console.log(`  🆔 Instance: ${this.instanceId}`);
      console.log('🔄 ===== FIN POLLING =====\n');

      return { 
        checked: users.length, 
        filtered: totalFiltered,
        processed: totalProcessed, 
        sent: totalSent,
        quotaBlocked: totalQuotaBlocked // ✅ AJOUT
      };

    } catch (error) {
      console.error(`❌ [${this.instanceId}] Erreur critique:`, error.message);
      console.error(error.stack);
      return { checked: 0, processed: 0, sent: 0, quotaBlocked: 0 };
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
        return { processed: 0, sent: 0, filtered: 0, quotaBlocked: 0 };
      }
      this.processingUsers.delete(userKey);
    }

    this.processingUsers.set(userKey, now);

    try {
      const newMessages = await this.fetchNewEmails(user.emailConfig, user);

      if (newMessages.length === 0) {
        return { processed: 0, sent: 0, filtered: 0, quotaBlocked: 0 };
      }

      console.log(`  📨 [${user.email}] ${newMessages.length} nouveau(x) message(s) non lu(s)`);

      const messageIds = newMessages.map(m => m.id);
      const alreadyInDb = await AutoReply.find({
        userId: user._id,
        messageId: { $in: messageIds }
      }).select('messageId');

      const processedIds = new Set(alreadyInDb.map(r => r.messageId));
      const messagesToProcess = newMessages.filter(m => !processedIds.has(m.id));

      if (messagesToProcess.length === 0) {
        console.log(`  ⏭️ [${user.email}] Tous déjà traités`);
        return { processed: 0, sent: 0, filtered: 0, quotaBlocked: 0 };
      }

      console.log(`  🆕 [${user.email}] ${messagesToProcess.length} nouveau(x) à analyser`);

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
      let quotaBlocked = 0; // ✅ AJOUT

      for (const message of messagesToProcess) {
        const result = await this.processMessage(message, user, driveData);
        
        if (result?.sent) {
          sent++;
        } else if (result?.filtered) {
          filtered++;
        } else if (result?.quotaExceeded) { // ✅ AJOUT
          quotaBlocked++;
        }
      }

      if (filtered > 0) {
        console.log(`  🔍 [${user.email}] ${filtered} filtré(s)`);
      }
      
      if (quotaBlocked > 0) { // ✅ AJOUT
        console.log(`  🚫 [${user.email}] ${quotaBlocked} bloqué(s) (quota)`);
      }

      return { processed: messagesToProcess.length, sent, filtered, quotaBlocked };

    } catch (error) {
      console.error(`  ❌ [${user.email}] Erreur:`, error.message);
      return { processed: 0, sent: 0, filtered: 0, quotaBlocked: 0 };
    } finally {
      this.processingUsers.delete(userKey);
    }
  }

  async processMessage(message, user, driveData) {
    const lockKey = `${user._id}-${message.id}`;
    const now = Date.now();
    
    const existsInDb = await AutoReply.findOne({
      userId: user._id,
      messageId: message.id
    });

    if (existsInDb) {
      return { sent: false, alreadyProcessed: true, filtered: false, quotaExceeded: false };
    }

    if (this.processingMessages.has(lockKey)) {
      return { sent: false, alreadyProcessed: true, filtered: false, quotaExceeded: false };
    }

    this.processingMessages.set(lockKey, now);

    try {
      const fullMessage = await this.fetchFullMessage(message.id, user.emailConfig);
      
      if (!fullMessage) {
        console.log(`    ❌ Impossible de récupérer le message`);
        return { sent: false, alreadyProcessed: false, filtered: false, quotaExceeded: false };
      }

      const bodySize = (fullMessage.body || '').length;
      if (bodySize > this.MAX_EMAIL_SIZE) {
        console.log(`    🔍 Trop volumineux (${Math.round(bodySize/1000)}KB)`);
        
        await AutoReply.create({
          userId: user._id,
          messageId: message.id,
          threadId: fullMessage.threadId,
          from: fullMessage.from,
          subject: fullMessage.subject || '(sans objet)',
          body: '[Message trop volumineux - non chargé]',
          status: 'ignored',
          analysis: { 
            isRelevant: false, 
            confidence: 1.0,
            intent: 'filtered',
            reason: 'Message trop volumineux' 
          }
        });
        
        return { sent: false, alreadyProcessed: false, filtered: true, quotaExceeded: false };
      }

      const lastMailKey = `${user._id}-${fullMessage.from}`;
      const lastMail = this.lastProcessedMail.get(lastMailKey);
      
      if (lastMail && (now - lastMail.timestamp) < this.MIN_EMAIL_INTERVAL) {
        const elapsed = Math.round((now - lastMail.timestamp) / 1000);
        console.log(`    🔍 Intervalle trop court (${elapsed}s)`);
        
        await AutoReply.create({
          userId: user._id,
          messageId: message.id,
          threadId: fullMessage.threadId,
          from: fullMessage.from,
          subject: fullMessage.subject || '(sans objet)',
          body: '[Message ignoré - intervalle trop court]',
          status: 'ignored',
          analysis: { 
            isRelevant: false,
            confidence: 1.0, 
            intent: 'filtered',
            reason: 'Intervalle trop court entre emails' 
          }
        });
        
        return { sent: false, alreadyProcessed: false, filtered: true, quotaExceeded: false };
      }

      if (fullMessage.threadId) {
        const shouldSkipThread = await this.shouldSkipThreadReply(
          fullMessage.threadId,
          user,
          fullMessage.from
        );

        if (shouldSkipThread.skip) {
          console.log(`    ⏭️ ${shouldSkipThread.reason}`);
          
          await AutoReply.create({
            userId: user._id,
            messageId: message.id,
            threadId: fullMessage.threadId,
            from: fullMessage.from,
            subject: fullMessage.subject || '(sans objet)',
            body: '[Message du même thread - conversation en cours]',
            status: 'ignored',
            analysis: { 
              isRelevant: false,
              confidence: 1.0,
              intent: 'waiting_user_action', 
              reason: shouldSkipThread.reason
            }
          });
          
          return { sent: false, alreadyProcessed: true, filtered: false, quotaExceeded: false };
        }
      }

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

      console.log(`    🤖 Analyse + Génération IA (2 étapes) avec contexte Drive...`);
      if (driveData?.businessInfo?.business?.name) {
        console.log(`    🏢 Entreprise: ${driveData.businessInfo.business.name}`);
      }
      
      const aiResult = await aiService.analyzeAndGenerateResponse(
        fullMessage, 
        user, 
        conversationHistory,
        driveData
      );

      // ✅ GESTION QUOTA DÉPASSÉ (analyse)
      if (aiResult.analysis.quotaExceeded) {
        console.log(`    🚫 Quota dépassé lors de l'analyse`);
        
        processingRecord.analysis = {
          isRelevant: false,
          confidence: 0.0,
          intent: 'quota_exceeded',
          reason: aiResult.analysis.reason || 'Quota quotidien dépassé'
        };
        processingRecord.status = 'ignored';
        await processingRecord.save();
        
        return { sent: false, alreadyProcessed: false, filtered: false, quotaExceeded: true };
      }

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
        
        this.markAsRead(message.id, user.emailConfig).catch(() => {});
        
        return { sent: false, alreadyProcessed: false, filtered: false, quotaExceeded: false };
      }

      console.log(`    ✅ Pertinent: ${aiResult.analysis.intent} (${(aiResult.analysis.confidence * 100).toFixed(0)}%)`);

      // ✅ GESTION QUOTA DÉPASSÉ (génération)
      if (aiResult.quotaExceeded) {
        console.log(`    🚫 Quota dépassé lors de la génération`);
        
        processingRecord.analysis = {
          isRelevant: true,
          confidence: aiResult.analysis.confidence,
          intent: aiResult.analysis.intent,
          reason: 'Quota dépassé - réponse non générée'
        };
        processingRecord.status = 'pending';
        processingRecord.generatedResponse = null;
        await processingRecord.save();
        
        return { sent: false, alreadyProcessed: false, filtered: false, quotaExceeded: true };
      }

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
        
        return { sent: false, alreadyProcessed: false, filtered: false, quotaExceeded: false };
      }

      console.log(`    ✅ Réponse générée (${aiResult.response.length} chars)`);

      const shouldAutoSend = user.aiSettings.autoReplyEnabled &&
                           !user.aiSettings.requireValidation &&
                           aiResult.analysis.confidence >= 0.8;

      if (shouldAutoSend) {
        // ✅ VÉRIFIER QUOTA EMAILS AVANT ENVOI
        const emailQuota = await quotaService.canSendEmail(user._id);
        
        if (!emailQuota.allowed) {
          console.log(`    🚫 Quota emails atteint (${emailQuota.remaining}), passage en pending`);
          
          processingRecord.analysis = {
            isRelevant: true,
            confidence: aiResult.analysis.confidence,
            intent: aiResult.analysis.intent,
            reason: 'Quota emails dépassé'
          };
          processingRecord.generatedResponse = aiResult.response;
          processingRecord.status = 'pending';
          await processingRecord.save();
          
          return { sent: false, alreadyProcessed: false, filtered: false, quotaExceeded: true };
        }
        
        console.log(`    📤 Envoi automatique...`);
        
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
          
          return { sent: false, alreadyProcessed: false, filtered: false, quotaExceeded: false };
        }

        // ✅ INCRÉMENTER COMPTEUR EMAILS APRÈS ENVOI RÉUSSI
        await quotaService.incrementEmailsSent(user._id);
        console.log(`    📧 Compteur emails incrémenté`);

        processingRecord.analysis = {
          isRelevant: true,
          confidence: aiResult.analysis.confidence,
          intent: aiResult.analysis.intent,
          details: aiResult.analysis.details
        };
        processingRecord.generatedResponse = aiResult.response;
        processingRecord.sentResponse = aiResult.response;
        processingRecord.status = 'sent';
        processingRecord.sentAt = new Date();
        await processingRecord.save();

        this.markAsRead(message.id, user.emailConfig).catch(() => {});

        if (fullMessage.threadId) {
          const threadKey = `${user._id}-${fullMessage.threadId}`;
          this.processedThreads.set(threadKey, Date.now());
        }
        
        this.lastProcessedMail.set(lastMailKey, {
          from: fullMessage.from,
          timestamp: now
        });

        console.log(`    ✅ Réponse envoyée avec succès`);
        return { sent: true, alreadyProcessed: false, filtered: false, quotaExceeded: false };

      } else {
        console.log(`    ⏸️ En attente validation (confiance: ${(aiResult.analysis.confidence * 100).toFixed(0)}%)`);
        
        processingRecord.analysis = {
          isRelevant: true,
          confidence: aiResult.analysis.confidence,
          intent: aiResult.analysis.intent,
          details: aiResult.analysis.details
        };
        processingRecord.generatedResponse = aiResult.response;
        processingRecord.status = 'pending';
        await processingRecord.save();

        return { sent: false, alreadyProcessed: false, filtered: false, quotaExceeded: false };
      }

    } catch (error) {
      console.error(`    ❌ Erreur traitement:`, error.message);
      console.error(error.stack);
      
      try {
        await AutoReply.deleteOne({
          userId: user._id,
          messageId: message.id,
          status: 'processing'
        });
      } catch {}
      
      return { sent: false, alreadyProcessed: false, filtered: false, quotaExceeded: false };
      
    } finally {
      this.processingMessages.delete(lockKey);
    }
  }

  async shouldSkipThreadReply(threadId, user, currentSenderEmail) {
    try {
      const lastBotReply = await AutoReply.findOne({
        userId: user._id,
        threadId: threadId,
        status: 'sent'
      }).sort({ sentAt: -1 }).limit(1);

      if (!lastBotReply) {
        return { skip: false };
      }

      const timeSinceLastBotReply = Date.now() - lastBotReply.sentAt.getTime();

      const conversationHistory = await this.getConversationHistory(
        threadId,
        user.emailConfig
      );

      if (conversationHistory.length === 0) {
        return { skip: false };
      }

      const lastMessage = conversationHistory[conversationHistory.length - 1];
      const botEmailAddresses = [
        user.email,
        user.emailConfig?.email,
        user.businessEmail
      ].filter(Boolean).map(e => e.toLowerCase());

      const lastMessageFromBot = botEmailAddresses.some(botEmail => 
        lastMessage.from.toLowerCase().includes(botEmail)
      );

      if (lastMessageFromBot && timeSinceLastBotReply < 300000) {
        return {
          skip: true,
          reason: `Dernière réponse du bot il y a ${Math.round(timeSinceLastBotReply/60000)} min, attente réponse client`
        };
      }

      return { skip: false };

    } catch (error) {
      console.error(`    ⚠️ Erreur analyse thread:`, error.message);
      return { skip: false };
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
              params: { q: 'is:unread in:inbox', minimal: 'true' },
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
    try {
      if (user.emailConfig.provider === 'gmail') {
        let originalMessageId = '';
        let references = '';
        
        if (message.threadId) {
          try {
            const threadResponse = await axios.get(
              `https://gmail.googleapis.com/gmail/v1/users/me/threads/${message.threadId}`,
              {
                headers: { 'Authorization': `Bearer ${user.emailConfig.accessToken}` },
                params: { format: 'metadata', metadataHeaders: 'Message-ID,References' },
                timeout: 15000
              }
            );

            const messages = threadResponse.data.messages || [];
            if (messages.length > 0) {
              const lastMessage = messages[messages.length - 1];
              const headers = lastMessage.payload?.headers || [];
              
              originalMessageId = headers.find(h => h.name === 'Message-ID')?.value || '';
              references = headers.find(h => h.name === 'References')?.value || '';
            }
          } catch (err) {
            console.warn('    ⚠️ Impossible de récupérer Message-ID:', err.message);
          }
        }

        const messageParts = [
          'Content-Type: text/plain; charset=utf-8',
          'MIME-Version: 1.0',
          `To: ${message.from}`,
          `Subject: Re: ${(message.subject || '(sans objet)').replace(/^Re:\s*/i, '')}`,
        ];

        if (originalMessageId) {
          messageParts.push(`In-Reply-To: ${originalMessageId}`);
          
          if (references) {
            messageParts.push(`References: ${references} ${originalMessageId}`);
          } else {
            messageParts.push(`References: ${originalMessageId}`);
          }
        }

        messageParts.push('');
        messageParts.push(responseBody);

        const email = messageParts.join('\r\n');
        const encodedMessage = Buffer.from(email)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        const response = await axios.post(
          'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
          {  // ✅ CORRECTION : Alignement correct
            raw: encodedMessage,
            threadId: message.threadId
          },
          {
            headers: {
              'Authorization': `Bearer ${user.emailConfig.accessToken}`,
              'Content-Type': 'application/json'
            },
            timeout: 15000
          }
        );

        console.log(`    ✅ Réponse envoyée dans thread ${message.threadId}`);
        return true;
        
      } else if (user.emailConfig.provider === 'outlook') {
        const BASE_URL = process.env.BASE_URL || 'https://k2s.onrender.com';
        
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
      if (error.response?.data) {
        console.error(`    📝 Détails:`, JSON.stringify(error.response.data));
      }
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
      // Silencieux
    }
  }
}

module.exports = new MailPollingService();






          
