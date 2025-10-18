const User = require('../models/User');
const AutoReply = require('../models/AutoReply');
const aiService = require('./ai.service');
const axios = require('axios');

class MailPollingService {
  constructor() {
    this.processingMessages = new Set(); // ✅ Verrou pour éviter les doublons
  }

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

      let totalSent = 0;

      // ✅ TRAITER UN UTILISATEUR À LA FOIS (pas en parallèle)
      for (const user of users) {
        const result = await this.checkUserEmails(user);
        if (result?.sent) {
          totalSent += result.sent;
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

      // ✅ TRAITER UN MESSAGE À LA FOIS (séquentiel)
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
    }
  }

  async processMessage(message, user) {
    // ✅ VÉRIFIER SI LE MESSAGE EST EN COURS DE TRAITEMENT
    const lockKey = `${user._id}-${message.id}`;
    
    if (this.processingMessages.has(lockKey)) {
      console.log(`    ⏭️ Message déjà en cours de traitement`);
      return { sent: false, alreadyProcessed: true };
    }

    // ✅ VERROUILLER LE MESSAGE
    this.processingMessages.add(lockKey);

    try {
      // ✅ VÉRIFIER SI DÉJÀ TRAITÉ
      const alreadyProcessed = await AutoReply.findOne({
        userId: user._id,
        messageId: message.id
      });

      if (alreadyProcessed) {
        await this.markAsRead(message.id, user.emailConfig);
        return { sent: false, alreadyProcessed: true };
      }

      console.log(`    📩 Nouveau: ${message.from} - "${message.subject}"`);

      const fullMessage = await this.fetchFullMessage(message.id, user.emailConfig);
      
      if (!fullMessage) {
        console.log(`    ❌ Impossible de récupérer le message`);
        await this.markAsRead(message.id, user.emailConfig);
        return { sent: false, alreadyProcessed: false };
      }

      const conversationHistory = await this.getConversationHistory(
        fullMessage.threadId, 
        user.emailConfig
      );

      const analysis = await aiService.analyzeMessage(fullMessage, user, conversationHistory);

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
        
        const sendSuccess = await this.sendReply(fullMessage, response, user);

        if (!sendSuccess) {
          console.log(`    ❌ Échec envoi`);
          return { sent: false, alreadyProcessed: false };
        }

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
      
    } finally {
      // ✅ DÉVERROUILLER LE MESSAGE
      this.processingMessages.delete(lockKey);
    }
  }

  // ... reste du code identique
}

module.exports = new MailPollingService();
