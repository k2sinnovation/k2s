const express = require('express');
const router = express.Router();
const axios = require('axios');
const driveService = require('../services/google-drive.service');
const Session = require('../models/Session');

// Limite de taille pour les mails à analyser
const MAX_EMAIL_SIZE = 5000; // caractères
// Délai minimum entre deux mails traités (en ms)
const MIN_EMAIL_INTERVAL = 60 * 1000; // 1 minute

// Middleware d'authentification
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  req.accessToken = token;
  next();
};

// Stockage du dernier mail traité par utilisateur
const lastProcessedMail = {};

// ========================================
// FONCTION UTILITAIRE : Ignorer les mails trop longs ou récents
// ========================================
const shouldProcessMail = (userId, mail) => {
  // Vérifie taille
  if (!mail.body || mail.body.length > MAX_EMAIL_SIZE) return false;

  // Vérifie intervalle de traitement
  const lastTime = lastProcessedMail[userId];
  const mailTime = new Date(mail.date).getTime();
  if (lastTime && (mailTime - lastTime < MIN_EMAIL_INTERVAL)) return false;

  // Met à jour dernier mail traité
  lastProcessedMail[userId] = mailTime;
  return true;
};

// ========================================
// GMAIL - récupérer mails non lus
// ========================================
router.get('/gmail/inbox', authMiddleware, async (req, res) => {
  try {
    const query = 'in:inbox is:unread';
    const response = await axios.get(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages',
      { headers: { Authorization: `Bearer ${req.accessToken}` }, params: { q: query, maxResults: 20 } }
    );

    if (!response.data.messages) return res.json({ messages: [] });

    // Récupère les détails seulement si nécessaire
    const mails = [];
    for (const msg of response.data.messages) {
      const message = await axios.get(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`,
        { headers: { Authorization: `Bearer ${req.accessToken}` }, params: { format: 'full' } }
      );

      // Extraire corps
      const extractBody = (part) => {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
        if (part.parts) {
          for (const p of part.parts) {
            const result = extractBody(p);
            if (result) return result;
          }
        }
        return '';
      };
      const body = extractBody(message.data.payload);

      const mailData = {
        id: message.data.id,
        threadId: message.data.threadId,
        from: message.data.payload.headers.find(h => h.name === 'From')?.value || '',
        subject: message.data.payload.headers.find(h => h.name === 'Subject')?.value || '',
        date: new Date(parseInt(message.data.internalDate)),
        body,
      };

      if (shouldProcessMail(req.userId, mailData)) {
        mails.push(mailData);
      } else {
        // Marquer comme lu pour ignorer les mails trop récents ou trop longs
        await axios.post(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${mailData.id}/modify`,
          { removeLabelIds: ['UNREAD'] },
          { headers: { Authorization: `Bearer ${req.accessToken}` } }
        );
      }
    }

    res.json({ messages: mails });

  } catch (error) {
    console.error('❌ [Gmail] Inbox error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// OUTLOOK - récupérer mails non lus
// ========================================
router.get('/outlook/inbox', authMiddleware, async (req, res) => {
  try {
    const response = await axios.get(
      'https://graph.microsoft.com/v1.0/me/messages',
      {
        headers: { Authorization: `Bearer ${req.accessToken}` },
        params: {
          $top: 20,
          $orderby: 'receivedDateTime desc',
          $filter: 'isRead eq false',
          $select: 'id,from,subject,receivedDateTime,bodyPreview,body',
        },
      }
    );

    const mails = [];
    for (const msg of response.data.value) {
      const body = msg.body?.content || msg.bodyPreview || '';
      const mailData = {
        id: msg.id,
        from: msg.from?.emailAddress?.address || '',
        subject: msg.subject || '',
        date: new Date(msg.receivedDateTime),
        body,
      };

      if (shouldProcessMail(req.userId, mailData)) {
        mails.push(mailData);
      } else {
        // Marquer comme lu pour ignorer les mails
        await axios.patch(
          `https://graph.microsoft.com/v1.0/me/messages/${mailData.id}`,
          { isRead: true },
          { headers: { Authorization: `Bearer ${req.accessToken}` } }
        );
      }
    }

    res.json({ messages: mails });

  } catch (error) {
    console.error('❌ [Outlook] Inbox error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// FONCTION : Répondre et marquer comme lu
// ========================================
const replyAndMarkReadGmail = async (accessToken, threadId, to, subject, body) => {
  const emailLines = [
    `To: ${to}`,
    `Subject: ${subject.startsWith('Re:') ? subject : `Re: ${subject}`}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    body,
  ];

  const encodedEmail = Buffer.from(emailLines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await axios.post(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    { raw: encodedEmail, threadId },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  // Marquer comme lu
  await axios.post(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${threadId}/modify`,
    { removeLabelIds: ['UNREAD'] },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
};

const replyAndMarkReadOutlook = async (accessToken, messageId, body) => {
  await axios.post(
    `https://graph.microsoft.com/v1.0/me/messages/${messageId}/reply`,
    { comment: body },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  // Marquer comme lu
  await axios.patch(
    `https://graph.microsoft.com/v1.0/me/messages/${messageId}`,
    { isRead: true },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
};

module.exports = router;
