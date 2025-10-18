const express = require('express');
const router = express.Router();
const AutoReply = require('../models/AutoReply');
const authenticateToken = require('../middleware/auth');

// 🆕 Vérifier si un message a une réponse IA
router.get('/check/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    
    const reply = await AutoReply.findOne({
      userId: req.user.id,
      messageId: messageId,
      status: 'sent' // Uniquement les réponses envoyées
    });

    res.json({ 
      hasReply: !!reply,
      sentAt: reply?.sentAt || null
    });
  } catch (error) {
    console.error('❌ Erreur check AI reply:', error);
    res.status(500).json({ error: error.message });
  }
});

// 🆕 Vérifier plusieurs messages en une fois (plus performant)
router.post('/check-batch', authenticateToken, async (req, res) => {
  try {
    const { messageIds } = req.body;
    
    if (!Array.isArray(messageIds)) {
      return res.status(400).json({ error: 'messageIds doit être un tableau' });
    }

    // Recherche optimisée en une seule requête
    const replies = await AutoReply.find({
      userId: req.user.id,
      messageId: { $in: messageIds },
      status: 'sent'
    }).select('messageId').lean();

    // Créer un Set pour recherche rapide
    const repliedIds = new Set(replies.map(r => r.messageId));

    // Créer le map de réponse
    const hasReplyMap = {};
    messageIds.forEach(id => {
      hasReplyMap[id] = repliedIds.has(id);
    });

    res.json(hasReplyMap);
  } catch (error) {
    console.error('❌ Erreur check batch:', error);
    res.status(500).json({ error: error.message });
  }
});

// 🆕 BONUS : Récupérer toutes les réponses envoyées (pour historique)
router.get('/sent', authenticateToken, async (req, res) => {
  try {
    const { limit = 50, skip = 0 } = req.query;

    const replies = await AutoReply.find({
      userId: req.user.id,
      status: 'sent'
    })
    .sort({ sentAt: -1 })
    .limit(parseInt(limit))
    .skip(parseInt(skip))
    .select('messageId threadId from subject sentAt generatedResponse')
    .lean();

    const total = await AutoReply.countDocuments({
      userId: req.user.id,
      status: 'sent'
    });

    res.json({
      replies,
      total,
      hasMore: total > (parseInt(skip) + replies.length)
    });
  } catch (error) {
    console.error('❌ Erreur récupération historique:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
