const { google } = require('googleapis');
const User = require('../models/User');
const aiService = require('./ai.service');
const mailService = require('./mail.service');
const AutoReply = require('../models/AutoReply');

class GmailWebhookService {
  
  /**
   * 🔔 Configurer le webhook Gmail pour un utilisateur
   */
  async setupWebhook(user) {
    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
        process.env.GMAIL_REDIRECT_URI
      );

      oauth2Client.setCredentials({
        access_token: user.emailConfig.accessToken,
        refresh_token: user.emailConfig.refreshToken
      });

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      // Créer ou mettre à jour le watch
      const response = await gmail.users.watch({
        userId: 'me',
        requestBody: {
          labelIds: ['INBOX'],
          topicName: process.env.GMAIL_PUBSUB_TOPIC, // projects/YOUR_PROJECT/topics/gmail-notifications
        }
      });

      console.log(`✅ [Webhook] Gmail configuré pour ${user.email}`);
      console.log(`📅 [Webhook] Expire le: ${new Date(response.data.expiration)}`);

      // Sauvegarder l'expiration
      user.emailConfig.webhookExpiration = new Date(response.data.expiration);
      await user.save();

      return true;

    } catch (error) {
      console.error(`❌ [Webhook] Erreur configuration Gmail:`, error.message);
      return false;
    }
  }

  /**
   * 📨 Traiter une notification Gmail
   */
  async handleGmailNotification(data) {
    try {
      const { emailAddress, historyId } = data;

      console.log(`📧 [Webhook] Notification reçue pour ${emailAddress}`);

      // Trouver l'utilisateur
      const user = await User.findOne({ 'emailConfig.email': emailAddress });

      if (!user) {
        console.log(`⚠️ [Webhook] Utilisateur non trouvé: ${emailAddress}`);
        return;
      }

      if (!user.aiSettings.isEnabled || !user.aiSettings.autoReplyEnabled) {
        console.log(`⏸️ [Webhook] Auto-réponse désactivée pour ${emailAddress}`);
        return;
      }

      // Récupérer les nouveaux messages
      const newMessages = await mailService.getUnreadMessages(user);

      if (newMessages.length === 0) {
        console.log(`ℹ️ [Webhook] Aucun nouveau message pour ${emailAddress}`);
        return;
      }

      console.log(`📨 [Webhook] ${newMessages.length} nouveaux messages à traiter`);

      for (const message of newMessages) {
        await this.processMessage(message, user);
      }

    } catch (error) {
      console.error(`❌ [Webhook] Erreur traitement notification:`, error.message);
    }
  }

  /**
   * 🤖 Traiter un message individuellement
   */
  async processMessage(message, user) {
    try {
      console.log(`🔍 [Webhook] Analyse du message de ${message.from}`);

      // 1️⃣ ANALYSE
      const analysis = await aiService.analyzeMessage(message, user);

      if (!analysis.is_relevant) {
        console.log(`⏭️ [Webhook] Message non pertinent de ${message.from}`);
        
        await AutoReply.create({
          userId: user._id,
          messageId: message.id,
          from: message.from,
          subject: message.subject,
          body: message.body,
          analysis: {
            isRelevant: false,
            confidence: analysis.confidence,
            intent: analysis.intent,
            reason: analysis.reason
          },
          status: 'ignored'
        });

        return;
      }

      console.log(`✅ [Webhook] Message pertinent : ${analysis.intent} (${(analysis.confidence * 100).toFixed(0)}%)`);

      // 2️⃣ GÉNÉRATION
      const response = await aiService.generateResponse(message, analysis, user);

      // 3️⃣ DÉCISION D'ENVOI
      const shouldAutoSend = user.aiSettings.autoReplyEnabled &&
                             !user.aiSettings.requireValidation &&
                             analysis.confidence >= 0.8;

      if (shouldAutoSend) {
        // ✅ ENVOI AUTOMATIQUE
        await mailService.sendReply({
          to: message.from,
          subject: message.subject ? `Re: ${message.subject}` : 'Re:',
          body: response,
          originalMessageId: message.id,
          user
        });

        await AutoReply.create({
          userId: user._id,
          messageId: message.id,
          from: message.from,
          subject: message.subject,
          body: message.body,
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

        console.log(`✅ [Webhook] Réponse automatique envoyée à ${message.from}`);

        // 📲 NOTIFICATION PUSH
        await this.sendPushNotification(user, {
          title: '✅ Réponse automatique envoyée',
          body: `Message de ${message.from} traité`,
          data: { messageId: message.id, from: message.from }
        });

      } else {
        // ⏸️ SAUVEGARDE POUR VALIDATION
        await AutoReply.create({
          userId: user._id,
          messageId: message.id,
          from: message.from,
          subject: message.subject,
          body: message.body,
          analysis: {
            isRelevant: true,
            confidence: analysis.confidence,
            intent: analysis.intent
          },
          generatedResponse: response,
          status: 'pending'
        });

        console.log(`⏸️ [Webhook] Réponse en attente de validation pour ${message.from}`);

        // 📲 NOTIFICATION PUSH
        await this.sendPushNotification(user, {
          title: '📝 Réponse à valider',
          body: `Message de ${message.from} - ${analysis.intent}`,
          data: { messageId: message.id, from: message.from }
        });
      }

    } catch (error) {
      console.error(`❌ [Webhook] Erreur traitement message:`, error.message);
    }
  }

  /**
   * 📲 Envoyer une notification push
   */
  async sendPushNotification(user, notification) {
    if (!user.fcmToken) {
      console.log(`⚠️ [Push] Pas de FCM token pour ${user.email}`);
      return;
    }

    try {
      const admin = require('firebase-admin');

      await admin.messaging().send({
        token: user.fcmToken,
        notification: {
          title: notification.title,
          body: notification.body
        },
        data: notification.data || {},
        android: {
          priority: 'high',
        },
        apns: {
          headers: {
            'apns-priority': '10'
          }
        }
      });

      console.log(`📲 [Push] Notification envoyée à ${user.email}`);

    } catch (error) {
      console.error(`❌ [Push] Erreur envoi notification:`, error.message);
    }
  }
}

module.exports = new GmailWebhookService();
