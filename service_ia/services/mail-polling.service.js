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

      for (const message of newMessages) {
        const result = await this.processMessage(message, user);
        if (result?.sent) sent++;
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
            q: 'is:unread in:inbox' // ✅ UNIQUEMENT les NON LUS
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

  async fetchFullMessage(messageId, emailConfig) {
    const BASE_URL = 'https://k2s.onrender.com';

    try {
      console.log(`📥 [Gmail] Message de récupération ${messageId}...`);
      
      const response = await axios.get(`${BASE_URL}/api/mail/gmail/message/${messageId}`, {
        headers: { 'Authorization': `Bearer ${emailConfig.accessToken}` },
        timeout: 15000
      });

      console.log(`✅ [Gmail] Message ${messageId} récupéré`);
      return response?.data || null;

    } catch (error) {
      console.error(`❌ Erreur récupération:`, error.message);
      return null;
    }
  }

  // ✅ MARQUAGE COMME LU AMÉLIORÉ
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
        console.log(`      ✅ Message marqué comme lu`);
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
        console.log(`      ✅ Message marqué comme lu`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`      ⚠️ Erreur marquage lu:`, error.message);
      return false;
    }
  }

  async processMessage(message, user) {
    try {
      console.log(`    🔍 Analyse: ${message.from} - "${message.subject}"`);

      // ✅ VÉRIFIER SI DÉJÀ TRAITÉ (EN BASE)
      const alreadyProcessed = await AutoReply.findOne({
        userId: user._id,
        messageId: message.id
      });

      if (alreadyProcessed) {
        console.log(`    ⏭️ Déjà traité`);
        
        // ✅ MARQUER COMME LU MÊME SI DÉJÀ TRAITÉ
        await this.markAsRead(message.id, user.emailConfig);
        
        return { sent: false };
      }

      // ✅ RÉCUPÉRER LE MESSAGE COMPLET UNE SEULE FOIS
      const fullMessage = await this.fetchFullMessage(message.id, user.emailConfig);
      
      if (!fullMessage) {
        console.log(`    ❌ Impossible de récupérer le message`);
        await this.markAsRead(message.id, user.emailConfig);
        return { sent: false };
      }

      // ✅ ANALYSE IA (UNE SEULE FOIS)
      const analysis = await aiService.analyzeMessage(fullMessage, user);

      // ✅ SI NON PERTINENT : SAUVEGARDER ET MARQUER LU
      if (!analysis.is_relevant) {
        console.log(`    ⏭️ Non pertinent: ${analysis.reason}`);
        
        await AutoReply.create({
          userId: user._id,
          messageId: message.id,
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
        return { sent: false };
      }

      console.log(`    ✅ Pertinent: ${analysis.intent} (${(analysis.confidence * 100).toFixed(0)}%)`);

      // ✅ GÉNÉRER LA RÉPONSE
      const response = await aiService.generateResponse(fullMessage, analysis, user);

      const shouldAutoSend = user.aiSettings.autoReplyEnabled &&
                           !user.aiSettings.requireValidation &&
                           analysis.confidence >= 0.8;

      if (shouldAutoSend) {
        console.log(`📤 Envoi automatique...`);
        
        // ✅ ENVOYER LA RÉPONSE UNE SEULE FOIS
        const sendSuccess = await this.sendReply(fullMessage, response, user);

        if (!sendSuccess) {
          console.log(`    ❌ Échec envoi`);
          return { sent: false };
        }

        // ✅ SAUVEGARDER EN BASE APRÈS ENVOI RÉUSSI
        await AutoReply.create({
          userId: user._id,
          messageId: message.id,
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

        // ✅ MARQUER COMME LU APRÈS ENVOI
        await this.markAsRead(message.id, user.emailConfig);

        console.log(`    ✅ Réponse envoyée à ${message.from}`);
        return { sent: true };

      } else {
        console.log(`    ⏸️ En attente de validation`);
        
        // ✅ SAUVEGARDER EN ATTENTE
        await AutoReply.create({
          userId: user._id,
          messageId: message.id,
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

        // ✅ NE PAS MARQUER LU SI VALIDATION REQUISE
        return { sent: false };
      }

    } catch (error) {
      console.error(`    ❌ Erreur traitement:`, error.message);
      
      // ✅ MARQUER LU EN CAS D'ERREUR POUR ÉVITER BOUCLE INFINIE
      try {
        await this.markAsRead(message.id, user.emailConfig);
      } catch (markError) {
        console.error(`    ⚠️ Impossible de marquer lu:`, markError.message);
      }
      
      return { sent: false };
    }
  }

  async sendReply(message, responseBody, user) {
    const BASE_URL = 'https://k2s.onrender.com';

    try {
      console.log(`📨 POST /api/mail/gmail/réponse`);
      
      if (user.emailConfig.provider === 'gmail') {
        console.log(`📤 [Gmail] Envoi réponse à ${message.from}...`);
        
        const response = await axios.post(`${BASE_URL}/api/mail/gmail/reply`, {
          threadId: message.threadId,
          to: message.from,
          subject: message.subject || '(sans objet)',
          body: responseBody
        }, {
          headers: { 'Authorization': `Bearer ${user.emailConfig.accessToken}` },
          timeout: 15000
        });

        console.log(`✅ [Gmail] Réponse envoyée`);
        return response.status === 200;
        
      } else if (user.emailConfig.provider === 'outlook') {
        console.log(`📤 [Outlook] Envoi réponse à ${message.from}...`);
        
        const response = await axios.post(`${BASE_URL}/api/mail/outlook/reply`, {
          messageId: message.id,
          to: message.from,
          subject: message.subject || '(sans objet)',
          body: responseBody
        }, {
          headers: { 'Authorization': `Bearer ${user.emailConfig.accessToken}` },
          timeout: 15000
        });

        console.log(`✅ [Outlook] Réponse envoyée`);
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
