const express = require('express');
const router = express.Router();
const AutoReply = require('../models/AutoReply');
const authenticateToken = require('../middleware/authenticate');

// ✅ Vérifier si un message a une réponse IA
router.get('/check/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    
    console.log(`🔍 [Check AI Reply] messageId=${messageId}, userId=${req.userId}`);
    
    const reply = await AutoReply.findOne({
      userId: req.userId, // ✅ CORRECTION : Utiliser req.userId (correspond au middleware)
      messageId: messageId,
      status: 'sent' // Uniquement les réponses envoyées
    });
    
    console.log(`✅ [Check AI Reply] Résultat: ${reply ? 'Trouvé' : 'Non trouvé'}`);
    
    res.json({ 
      hasReply: !!reply,
      sentAt: reply?.sentAt || null
    });
  } catch (error) {
    console.error('❌ Erreur check AI reply:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ Vérifier plusieurs messages en une fois (plus performant)
router.post('/check-batch', authenticateToken, async (req, res) => {
  try {
    const { messageIds } = req.body;
    
    if (!Array.isArray(messageIds)) {
      return res.status(400).json({ error: 'messageIds doit être un tableau' });
    }

    console.log(`🔍 [Check Batch] Vérification de ${messageIds.length} messages pour userId=${req.userId}`);
    
    // ✅ Recherche optimisée en une seule requête
    const replies = await AutoReply.find({
      userId: req.userId, // ✅ CORRECTION : Utiliser req.userId au lieu de req.user.id
      messageId: { $in: messageIds },
      status: 'sent' // Uniquement les réponses envoyées
    }).select('messageId').lean();
    
    // Créer un Set pour recherche rapide
    const repliedIds = new Set(replies.map(r => r.messageId));
    
    // Créer le map de réponse
    const hasReplyMap = {};
    messageIds.forEach(id => {
      hasReplyMap[id] = repliedIds.has(id);
    });

    console.log(`✅ [Check Batch] ${replies.length} réponse(s) IA trouvée(s) sur ${messageIds.length}`);
    
    // ✅ DEBUG : Afficher les messages avec réponse
    if (replies.length > 0) {
      console.log(`🤖 Messages avec réponse IA:`, replies.map(r => r.messageId.substring(0, 10) + '...'));
    }
    
    res.json(hasReplyMap);
  } catch (error) {
    console.error('❌ Erreur check batch:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ BONUS : Récupérer toutes les réponses envoyées (pour historique)
router.get('/sent', authenticateToken, async (req, res) => {
  try {
    const { limit = 50, skip = 0 } = req.query;
    
    console.log(`📊 [Get Sent] userId=${req.userId}, limit=${limit}, skip=${skip}`);
    
    const replies = await AutoReply.find({
      userId: req.userId, // ✅ CORRECTION : Utiliser req.userId
      status: 'sent'
    })
    .sort({ sentAt: -1 })
    .limit(parseInt(limit))
    .skip(parseInt(skip))
    .select('messageId threadId from subject sentAt generatedResponse')
    .lean();
    
    const total = await AutoReply.countDocuments({
      userId: req.userId, // ✅ CORRECTION : Utiliser req.userId
      status: 'sent'
    });

    console.log(`✅ [Get Sent] ${replies.length} réponses retournées sur ${total} total`);
    
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

// ✅ NOUVEAU : Récupérer les détails d'une réponse spécifique
router.get('/reply/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    
    console.log(`🔍 [Get Reply Detail] messageId=${messageId}, userId=${req.userId}`);
    
    const reply = await AutoReply.findOne({
      userId: req.userId,
      messageId: messageId
    }).lean();
    
    if (!reply) {
      return res.status(404).json({ error: 'Réponse non trouvée' });
    }
    
    console.log(`✅ [Get Reply Detail] Trouvée: status=${reply.status}`);
    
    res.json(reply);
  } catch (error) {
    console.error('❌ Erreur récupération détail:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ NOUVEAU : Supprimer les enregistrements "processing" bloqués (maintenance)
router.delete('/cleanup-stuck', authenticateToken, async (req, res) => {
  try {
    const ONE_HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000);
    
    console.log(`🧹 [Cleanup] Nettoyage des processing bloqués pour userId=${req.userId}`);
    
    const result = await AutoReply.deleteMany({
      userId: req.userId,
      status: 'processing',
      createdAt: { $lt: ONE_HOUR_AGO } // Plus vieux qu'1 heure
    });
    
    console.log(`✅ [Cleanup] ${result.deletedCount} enregistrements supprimés`);
    
    res.json({
      deleted: result.deletedCount,
      message: `${result.deletedCount} enregistrement(s) bloqué(s) supprimé(s)`
    });
  } catch (error) {
    console.error('❌ Erreur nettoyage:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ NOUVEAU : Statistiques des réponses IA
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    console.log(`📊 [Stats] userId=${req.userId}`);
    
    const [sent, pending, ignored, processing] = await Promise.all([
      AutoReply.countDocuments({ userId: req.userId, status: 'sent' }),
      AutoReply.countDocuments({ userId: req.userId, status: 'pending' }),
      AutoReply.countDocuments({ userId: req.userId, status: 'ignored' }),
      AutoReply.countDocuments({ userId: req.userId, status: 'processing' })
    ]);
    
    // Statistiques sur les 30 derniers jours
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const recentStats = await AutoReply.aggregate([
      {
        $match: {
          userId: req.userId,
          createdAt: { $gte: thirtyDaysAgo },
          status: 'sent'
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$sentAt" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    console.log(`✅ [Stats] sent=${sent}, pending=${pending}, ignored=${ignored}, processing=${processing}`);
    
    res.json({
      total: {
        sent,
        pending,
        ignored,
        processing
      },
      last30Days: recentStats
    });
  } catch (error) {
    console.error('❌ Erreur statistiques:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
