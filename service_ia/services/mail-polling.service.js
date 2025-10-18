const User = require('../models/User');
const AutoReply = require('../models/AutoReply');
const aiService = require('./ai.service');
const axios = require('axios');

class MailPollingService {

  async checkAllUsers() {
    try {
      const startTime = Date.now();
      console.log('🔍 [Polling] Vérification...');

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
            totalSent++;
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
    try {
      const newMessages = await this.fetchNewEmails(user.emailConfig);

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

      // ✅ LOG GROUPÉ : Afficher une seule fois le nombre de messages déjà traités
      if (alreadyProcessedCount > 0) {
        console.log(`  ⏭️ ${alreadyProcessedCount} messages déjà traités (0 token consommé)`);
      }

      return { processed: newMessages.length, sent };

    } catch (error) {
      console.error(`  ❌ [${user.email}] Erreur:`, error.message);
      return { processed: 0, sent: 0 };
    }
  }

  async fetchNewEmails(emailConfig) {
    const BASE_URL = 'https://k2s.onrender.com';

    try {
      let response;

      if (emailConfig.provider === 'gmail') {
        response = await axios.get(`${BASE_URL}/api/mail/gmail/inbox`, {
          headers: { 'Authorization': `Bearer ${emailConfig.accessToken}` },
          params: {
            q: 'is:unread in:inbox'
          },
          timeout: 15000
        });
        
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
      // Ignorer silencieusement les erreurs de marquage
      return false;
    }
  }

  // ✅ NOUVELLE FONCTION : Récupérer l'historique de la conversation
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
      
      // Parser les messages de la conversation
      const history = [];
      for (const msg of messages) {
        const headers = msg.payload?.headers || [];
        const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
        const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
        
        // Extraire le body
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
          body: body.substring(0, 500), // Limiter pour économiser tokens
          date: new Date(parseInt(msg.internalDate))
        });
      }

      // Trier par date (plus ancien en premier)
      history.sort((a, b) => a.date - b.date);

      return history;

    } catch (error) {
      console.error(`    ⚠️ Impossible de récupérer l'historique:`, error.message);
      return [];
    }
  }

  async processMessage(message, user) {
    try {
      // ✅ VÉRIFIER SI DÉJÀ TRAITÉ (SILENCIEUX)
      const alreadyProcessed = await AutoReply.findOne({
        userId: user._id,
        messageId: message.id
      });

      if (alreadyProcessed) {
        // ✅ Marquer comme lu silencieusement (pas de log)
        await this.markAsRead(message.id, user.emailConfig);
        
        // ✅ Retourner un flag pour compter les messages déjà traités
        return { sent: false, alreadyProcessed: true };
      }

      // ✅ NOUVEAU MESSAGE : Logger seulement celui-ci
      console.log(`    📩 Nouveau: ${message.from} - "${message.subject}"`);

      // ✅ RÉCUPÉRER LE MESSAGE COMPLET
      const fullMessage = await this.fetchFullMessage(message.id, user.emailConfig);
      
      if (!fullMessage) {
        console.log(`    ❌ Impossible de récupérer le message`);
        await this.markAsRead(message.id, user.emailConfig);
        return { sent: false, alreadyProcessed: false };
      }

      // ✅ RÉCUPÉRER L'HISTORIQUE DE LA CONVERSATION
      const conversationHistory = await this.getConversationHistory(
        fullMessage.threadId, 
        user.emailConfig
      );

      // ✅ ANALYSE IA (avec contexte de conversation)
      const analysis = await aiService.analyzeMessage(fullMessage, user, conversationHistory);

      // ✅ SI NON PERTINENT : SAUVEGARDER ET MARQUER LU
      if (!analysis.is_relevant) {
        console.log(`    ⏭️ Non pertinent: ${analysis.reason}`);
        
        await AutoReply.create({
          userId: user._id,
          messageId: message.id,
          threadId: fullMessage.threadId,
          from: message.from,
          subject: message.subject,
          body: fullMessage.body,
          analysis: {
            isRelevant: false,
            confidence: analysis.confidence,
            intent: analysis.intent,
            reason: analysis.reason
          },
          status: 'ignored'
        });

        await this.markAsRead(message.id, user.emailConfig);
        return { sent: false, alreadyProcessed: false };
      }

      console.log(`    ✅ Pertinent: ${analysis.intent} (${(analysis.confidence * 100).toFixed(0)}%)`);

      // ✅ GÉNÉRER LA RÉPONSE (avec contexte de conversation)
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
        
        // ✅ RÉPONDRE DANS LE THREAD (pas créer nouveau message)
        const sendSuccess = await this.sendReply(fullMessage, response, user);

        if (!sendSuccess) {
          console.log(`    ❌ Échec envoi`);
          return { sent: false, alreadyProcessed: false };
        }

        // ✅ SAUVEGARDER EN BASE
        await AutoReply.create({
          userId: user._id,
          messageId: message.id,
          threadId: fullMessage.threadId,
          from: message.from,
          subject: message.subject,
          body: fullMessage.body,
          analysis: {
            isRelevant: true,
            confidence: analysis.confidence,
            intent: analysis.intent
          },
          generatedResponse: response,
          sentResponse: response,
          status: 'sent',
          sentAt: new Date()
        });

        // ✅ MARQUER COMME LU
        await this.markAsRead(message.id, user.emailConfig);

        console.log(`    ✅ Réponse envoyée à ${message.from}`);
        return { sent: true, alreadyProcessed: false };

      } else {
        console.log(`    ⏸️ En attente de validation`);
        
        await AutoReply.create({
          userId: user._id,
          messageId: message.id,
          threadId: fullMessage.threadId,
          from: message.from,
          subject: message.subject,
          body: fullMessage.body,
          analysis: {
            isRelevant: true,
            confidence: analysis.confidence,
            intent: analysis.intent
          },
          generatedResponse: response,
          status: 'pending'
        });

        return { sent: false, alreadyProcessed: false };
      }

    } catch (error) {
      console.error(`    ❌ Erreur traitement:`, error.message);
      
      try {
        await this.markAsRead(message.id, user.emailConfig);
      } catch (markError) {}
      
      return { sent: false, alreadyProcessed: false };
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
        // ✅ UTILISER threadId pour répondre dans la conversation
        const response = await axios.post(`${BASE_URL}/api/mail/gmail/reply`, {
          threadId: message.threadId,  // ← Important pour garder la conversation
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
