const express = require('express');
const router = express.Router();
const gmailWebhookService = require('../services/gmail-webhook.service');

/**
 * POST /webhook/gmail
 * 🔔 Recevoir les notifications Gmail Pub/Sub
 */
router.post('/gmail', async (req, res) => {
  try {
    // Gmail envoie les données en base64
    const message = req.body.message;
    
    if (!message || !message.data) {
      return res.status(400).json({ error: 'Message invalide' });
    }

    // Décoder les données
    const decodedData = Buffer.from(message.data, 'base64').toString();
    const data = JSON.parse(decodedData);

    console.log('📧 [Webhook] Notification Gmail reçue:', data);

    // Traiter de manière asynchrone (ne pas bloquer la réponse)
    gmailWebhookService.handleGmailNotification(data).catch(error => {
      console.error('❌ [Webhook] Erreur traitement asynchrone:', error);
    });

    // Répondre immédiatement à Gmail (obligatoire)
    res.status(200).json({ success: true });

  } catch (error) {
    console.error('❌ [Webhook] Erreur route:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /webhook/outlook
 * 🔔 Recevoir les notifications Outlook
 */
router.post('/outlook', async (req, res) => {
  try {
    const { value } = req.body;

    if (!value || value.length === 0) {
      return res.status(200).json({ success: true }); // Validation initiale
    }

    console.log('📧 [Webhook] Notification Outlook reçue');

    for (const notification of value) {
      const { resource, changeType } = notification;

      if (changeType === 'created') {
        // Extraire l'email de l'utilisateur depuis la resource
        // Format: /users/{email}/messages/{messageId}
        const emailMatch = resource.match(/\/users\/([^\/]+)\//);
        
        if (emailMatch) {
          const emailAddress = emailMatch[1];
          
          gmailWebhookService.handleGmailNotification({
            emailAddress,
            historyId: null // Outlook n'utilise pas historyId
          }).catch(error => {
            console.error('❌ [Webhook] Erreur traitement Outlook:', error);
          });
        }
      }
    }

    res.status(200).json({ success: true });

  } catch (error) {
    console.error('❌ [Webhook] Erreur route Outlook:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
