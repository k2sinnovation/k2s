const express = require('express');
const router = express.Router();
const axios = require('axios');

// ===== MIDDLEWARE D'AUTHENTIFICATION =====

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Token manquant' });
  }
  req.accessToken = token;
  next();
};

// ========================================
// GMAIL API ROUTES - VERSION OPTIMISÉE
// ========================================

// ⚡ GET /api/mail/gmail/inbox - VERSION ULTRA-OPTIMISÉE (1 SEULE REQUÊTE)
router.get('/gmail/inbox', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    const query = q || 'in:inbox';
    
    console.log(`📥 [Gmail] Récupération avec filtre: "${query}"`);

    // ⚡ 1 SEULE REQUÊTE : Récupérer juste les IDs
    const response = await axios.get(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages',
      {
        headers: { Authorization: `Bearer ${req.accessToken}` },
        params: { 
          q: query, // ⭐ Filtre appliqué (ex: "is:unread in:inbox")
          maxResults: 20 
        },
      }
    );

    if (!response.data.messages) {
      console.log('📭 [Gmail] Aucun message');
      return res.json({ messages: [] });
    }

    // ⚡ Retourner juste les IDs + threadIds
    // Les détails seront récupérés UNIQUEMENT si nécessaire
    const messages = response.data.messages.map(msg => ({
      id: msg.id,
      threadId: msg.threadId
    }));

    console.log(`✅ [Gmail] ${messages.length} message(s)`);

    res.json({ messages });

  } catch (error) {
    console.error('❌ [Gmail] Erreur inbox:', error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Erreur récupération emails',
      details: error.message 
    });
  }
});

// GET /api/mail/gmail/message/:id - Récupérer UN email complet
router.get('/gmail/message/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`📥 [Gmail] Récupération message ${id}...`);

    const response = await axios.get(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`,
      {
        headers: { Authorization: `Bearer ${req.accessToken}` },
        params: { format: 'full' },
      }
    );

    const message = response.data;
    const headers = message.payload.headers;
    
    // Extraire le corps du message
    let body = '';
    let isHtml = false;
    
    const extractBody = (part) => {
      if (part.mimeType === 'text/html' || part.mimeType === 'text/plain') {
        if (part.body?.data) {
          return {
            content: Buffer.from(part.body.data, 'base64').toString('utf-8'),
            isHtml: part.mimeType === 'text/html'
          };
        }
      }
      
      if (part.parts) {
        for (const subPart of part.parts) {
          const result = extractBody(subPart);
          if (result) return result;
        }
      }
      
      return null;
    };
    
    const bodyData = extractBody(message.payload);
    if (bodyData) {
      body = bodyData.content;
      isHtml = bodyData.isHtml;
    }

    console.log(`✅ [Gmail] Message ${id} récupéré`);

    res.json({
      id: message.id,
      threadId: message.threadId,
      from: headers.find(h => h.name === 'From')?.value || '',
      to: headers.find(h => h.name === 'To')?.value || '',
      subject: headers.find(h => h.name === 'Subject')?.value || '(sans objet)',
      date: new Date(parseInt(message.internalDate)),
      body,
      isHtml,
      labelIds: message.labelIds,
    });

  } catch (error) {
    console.error('❌ [Gmail] Erreur message:', error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Erreur récupération message',
      details: error.message 
    });
  }
});

// GET /api/mail/gmail/search - Rechercher des emails Gmail
router.get('/gmail/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Paramètre q manquant' });
    }

    console.log(`🔍 [Gmail] Recherche: ${q}`);

    const response = await axios.get(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages',
      {
        headers: { Authorization: `Bearer ${req.accessToken}` },
        params: { q, maxResults: 20 },
      }
    );

    if (!response.data.messages) {
      return res.json({ messages: [] });
    }

    // Retourner juste les IDs
    const messages = response.data.messages.map(msg => ({
      id: msg.id,
      threadId: msg.threadId
    }));

    console.log(`✅ [Gmail] ${messages.length} résultat(s)`);

    res.json({ messages });

  } catch (error) {
    console.error('❌ [Gmail] Erreur recherche:', error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Erreur recherche',
      details: error.message 
    });
  }
});

// POST /api/mail/gmail/reply - Répondre à un email Gmail
router.post('/gmail/reply', authMiddleware, async (req, res) => {
  try {
    const { threadId, to, subject, body } = req.body;

    if (!to || !body) {
      return res.status(400).json({ error: 'Destinataire et corps requis' });
    }

    console.log(`📤 [Gmail] Envoi réponse à ${to}...`);

    const emailLines = [
      `To: ${to}`,
      `Subject: ${subject.startsWith('Re:') ? subject : `Re: ${subject}`}`,
      'Content-Type: text/plain; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      body,
    ];

    const email = emailLines.join('\r\n');

    const encodedEmail = Buffer.from(email)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const payload = { raw: encodedEmail };
    if (threadId) {
      payload.threadId = threadId;
    }

    const response = await axios.post(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      payload,
      { 
        headers: { 
          'Authorization': `Bearer ${req.accessToken}`,
          'Content-Type': 'application/json'
        } 
      }
    );

    console.log(`✅ [Gmail] Réponse envoyée (messageId: ${response.data.id})`);

    res.json({ 
      success: true, 
      messageId: response.data.id,
      threadId: response.data.threadId
    });

  } catch (error) {
    console.error('❌ [Gmail] Erreur envoi:', error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Erreur envoi réponse',
      details: error.response?.data || error.message 
    });
  }
});

// POST /api/mail/gmail/mark-read - Marquer comme lu
router.post('/gmail/mark-read', authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.body;

    if (!messageId) {
      return res.status(400).json({ error: 'messageId requis' });
    }

    await axios.post(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
      {
        removeLabelIds: ['UNREAD']
      },
      {
        headers: { 
          'Authorization': `Bearer ${req.accessToken}`,
          'Content-Type': 'application/json'
        },
      }
    );

    console.log(`✓ Message ${messageId} marqué comme lu`);

    res.json({ success: true });

  } catch (error) {
    console.error('❌ [Gmail] Erreur mark-read:', error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Erreur marquage',
      details: error.message 
    });
  }
});

// ========================================
// OUTLOOK API ROUTES
// ========================================

// GET /api/mail/outlook/inbox - Récupérer les emails Outlook
router.get('/outlook/inbox', authMiddleware, async (req, res) => {
  try {
    const { skip, filter } = req.query;
    const url = 'https://graph.microsoft.com/v1.0/me/messages';
    
    const params = {
      $top: 20,
      $orderby: 'receivedDateTime desc',
      $select: 'id,from,subject,receivedDateTime,bodyPreview,isRead',
    };
    
    if (skip) params.$skip = parseInt(skip);
    if (filter) params.$filter = filter; // ex: "isRead eq false"

    console.log('📥 [Outlook] Récupération inbox...');

    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${req.accessToken}` },
      params,
    });

    const messages = response.data.value.map(msg => ({
      id: msg.id,
      from: msg.from?.emailAddress?.address || '',
      subject: msg.subject || '(sans objet)',
      date: new Date(msg.receivedDateTime),
      snippet: msg.bodyPreview,
      isRead: msg.isRead,
    }));

    console.log(`✅ [Outlook] ${messages.length} emails récupérés`);

    res.json({
      messages,
      nextSkip: skip ? parseInt(skip) + 20 : 20,
    });

  } catch (error) {
    console.error('❌ [Outlook] Erreur inbox:', error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Erreur récupération emails',
      details: error.message 
    });
  }
});

// GET /api/mail/outlook/message/:id - Récupérer un email complet Outlook
router.get('/outlook/message/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`📥 [Outlook] Récupération message ${id}...`);

    const response = await axios.get(
      `https://graph.microsoft.com/v1.0/me/messages/${id}`,
      {
        headers: { Authorization: `Bearer ${req.accessToken}` },
        params: { $select: 'id,from,toRecipients,subject,receivedDateTime,body,isRead' },
      }
    );

    const msg = response.data;

    console.log(`✅ [Outlook] Message ${id} récupéré`);

    res.json({
      id: msg.id,
      from: msg.from?.emailAddress?.address || '',
      to: msg.toRecipients?.map(r => r.emailAddress?.address).join(', ') || '',
      subject: msg.subject || '(sans objet)',
      date: new Date(msg.receivedDateTime),
      body: msg.body?.content || '',
      isHtml: msg.body?.contentType === 'html',
      isRead: msg.isRead,
    });

  } catch (error) {
    console.error('❌ [Outlook] Erreur message:', error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Erreur récupération message',
      details: error.message 
    });
  }
});

// GET /api/mail/outlook/search - Rechercher des emails Outlook
router.get('/outlook/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Paramètre q manquant' });
    }

    console.log(`🔍 [Outlook] Recherche: ${q}`);

    const response = await axios.get(
      'https://graph.microsoft.com/v1.0/me/messages',
      {
        headers: { Authorization: `Bearer ${req.accessToken}` },
        params: {
          $search: `"${q}"`,
          $top: 20,
          $select: 'id,from,subject,receivedDateTime,bodyPreview,isRead',
        },
      }
    );

    const messages = response.data.value.map(msg => ({
      id: msg.id,
      from: msg.from?.emailAddress?.address || '',
      subject: msg.subject || '',
      date: new Date(msg.receivedDateTime),
      snippet: msg.bodyPreview,
      isRead: msg.isRead,
    }));

    console.log(`✅ [Outlook] ${messages.length} résultat(s)`);

    res.json({ messages });

  } catch (error) {
    console.error('❌ [Outlook] Erreur recherche:', error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Erreur recherche',
      details: error.message 
    });
  }
});

// POST /api/mail/outlook/reply - Répondre à un email Outlook
router.post('/outlook/reply', authMiddleware, async (req, res) => {
  try {
    const { messageId, to, subject, body } = req.body;

    if (!to || !body) {
      return res.status(400).json({ error: 'Destinataire et corps requis' });
    }

    console.log(`📤 [Outlook] Envoi réponse à ${to}...`);

    await axios.post(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}/reply`,
      { comment: body },
      {
        headers: {
          Authorization: `Bearer ${req.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('✅ [Outlook] Réponse envoyée');

    res.json({ success: true, message: 'Réponse envoyée' });

  } catch (error) {
    console.error('❌ [Outlook] Erreur envoi:', error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Erreur envoi réponse',
      details: error.message 
    });
  }
});

module.exports = router;
