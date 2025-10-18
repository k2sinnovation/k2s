const User = require('../models/User');
const AutoReply = require('../models/AutoReply');
const aiService = require('./ai.service');
const axios = require('axios');

class MailPollingService {

  /**
   * 🔍 Vérifier tous les utilisateurs
   */
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

  /**
   * 📨 Vérifier les emails d'un utilisateur
   */
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

  /**
   * 📥 Récupérer les nouveaux emails (NON-LUS UNIQUEMENT)
   */
  async fetchNewEmails(emailConfig) {
    const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

    try {
      let response;

      if (emailConfig.provider === 'gmail') {
        response = await axios.get(`${BASE_URL}/api/mail/gmail/search`, {
          headers: { 'Authorization': `Bearer ${emailConfig.accessToken}` },
          params: { 
            q: 'is:unread in:inbox'
          },
          timeout: 15000
        });
      } else if (emailConfig.provider === 'outlook') {
        response = await axios.get(`${BASE_URL}/api/mail/outlook/inbox`, {
          headers: { 'Authorization': `Bearer ${emailConfig.accessToken}` },
          timeout: 15000
        });
        
        if (response?.data?.messages) {
          response.data.messages = response.data.messages.filter(msg => !msg.isRead);
        }
      }

      return response?.data?.messages || [];

    } catch (error) {
      if (error.response?.status === 429) {
        console.warn(`  ⚠️ [Quota] Limite atteinte`);
      } else {
        console.error(`  ❌ [Fetch] Erreur:`, error.message);
      }
      return [];
    }
  }

  /**
   * 🤖 Traiter un message
   */
  async processMessage(message, user) {
    try {
      console.log(`    🔍 Analyse: ${message.from} - "${message.subject}"`);

      // Vérifier si déjà traité
      const alreadyProcessed = await AutoReply.findOne({
        userId: user._id,
        messageId: message.id
      });

      if (alreadyProcessed) {
        console.log(`    ⏭️ Déjà traité`);
        return { sent: false };
      }

      // ✅ RÉCUPÉRER LE CORPS COMPLET DU MESSAGE
      const fullMessage = await this.fetchFullMessage(message.id, user.emailConfig);
      
      if (!fullMessage) {
        console.log(`    ❌ Impossible de récupérer le message complet`);
        return { sent: false };
      }

      // 1️⃣ ANALYSE
      const analysis = await aiService.analyzeMessage(fullMessage, user);

      if (!analysis.is_relevant) {
        console.log(`    ⏭️ Non pertinent: ${analysis.reason || 'Non lié à l\'activité'}`);
        
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
        return { sent: false };
      }

      console.log(`    ✅ Pertinent: ${analysis.intent} (confiance: ${(analysis.confidence * 100).toFixed(0)}%)`);

      // 2️⃣ GÉNÉRATION
      console.log(`    🤖 Génération de la réponse...`);
      const response = await aiService.generateResponse(fullMessage, analysis, user);

      // 3️⃣ DÉCISION D'ENVOI
      const shouldAutoSend = user.aiSettings.autoReplyEnabled &&
                             !user.aiSettings.requireValidation &&
                             analysis.confidence >= 0.8;

      if (shouldAutoSend) {
        // ✅ ENVOI AUTOMATIQUE
        console.log(`    📤 Envoi automatique (confiance ${(analysis.confidence * 100).toFixed(0)}% ≥ 80%)...`);
        
        await this.sendReply(fullMessage, response, user);

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

        console.log(`    ✅ Réponse envoyée avec succès à ${message.from}`);
        return { sent: true };

      } else {
        // ⏸️ EN ATTENTE DE VALIDATION
        const reason = !user.aiSettings.autoReplyEnabled 
          ? 'Auto-reply désactivé'
          : user.aiSettings.requireValidation
          ? 'Validation requise'
          : `Confiance insuffisante (${(analysis.confidence * 100).toFixed(0)}% < 80%)`;
        
        console.log(`    ⏸️ En attente de validation: ${reason}`);
        
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

        return { sent: false };
      }

    } catch (error) {
      console.error(`    ❌ Erreur traitement:`, error.message);
      return { sent: false };
    }
  }

  /**
   * 📥 Récupérer le message complet avec le corps
   */
  async fetchFullMessage(messageId, emailConfig) {
    const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

    try {
      let response;

      if (emailConfig.provider === 'gmail') {
        response = await axios.get(`${BASE_URL}/api/mail/gmail/message/${messageId}`, {
          headers: { 'Authorization': `Bearer ${emailConfig.accessToken}` },
          timeout: 15000
        });
      } else if (emailConfig.provider === 'outlook') {
        response = await axios.get(`${BASE_URL}/api/mail/outlook/message/${messageId}`, {
          headers: { 'Authorization': `Bearer ${emailConfig.accessToken}` },
          timeout: 15000
        });
      }

      return response?.data || null;

    } catch (error) {
      console.error(`    ❌ Erreur récupération message complet:`, error.message);
      return null;
    }
  }

  /**
   * 📤 Envoyer une réponse
   */
  async sendReply(message, responseBody, user) {
    const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

    try {
      if (user.emailConfig.provider === 'gmail') {
        await axios.post(`${BASE_URL}/api/mail/gmail/reply`, {
          threadId: message.threadId,
          to: message.from,
          subject: message.subject || '(sans objet)',
          body: responseBody
        }, {
          headers: { 'Authorization': `Bearer ${user.emailConfig.accessToken}` },
          timeout: 15000
        });
        
      } else if (user.emailConfig.provider === 'outlook') {
        await axios.post(`${BASE_URL}/api/mail/outlook/reply`, {
          messageId: message.id,
          to: message.from,
          subject: message.subject || '(sans objet)',
          body: responseBody
        }, {
          headers: { 'Authorization': `Bearer ${user.emailConfig.accessToken}` },
          timeout: 15000
        });
      }

      return true;
      
    } catch (error) {
      console.error(`    ❌ Erreur envoi réponse:`, error.message);
      throw error;
    }
  }

} // ✅ ACCOLADE DE FIN DE CLASSE

module.exports = new MailPollingService();
