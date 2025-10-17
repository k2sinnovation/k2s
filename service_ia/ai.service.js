const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const aiService = require('../services/ai.service');
const mailService = require('../services/mail.service');
const AutoReply = require('../models/AutoReply');
const User = require('../models/User');

/**
 * POST /api/ai/analyze
 * 🔍 Analyser un message
 */
router.post('/analyze', protect, async (req, res) => {
  try {
    const { messageId, from, subject, body, source } = req.body;

    if (!body) {
      return res.status(400).json({ error: 'Corps du message requis' });
    }

    const user = await User.findById(req.user.id);
    
    const messageData = {
      id: messageId,
      from: from || 'inconnu@example.com',
      subject: subject || '',
      body,
      source: source || 'email'
    };

    const analysis = await aiService.analyzeMessage(messageData, user);

    // Sauvegarder l'analyse
    await AutoReply.create({
      userId: user._id,
      messageId: messageId || Date.now().toString(),
      from: messageData.from,
      subject: messageData.subject,
      body: messageData.body,
      analysis: {
        isRelevant: analysis.is_relevant,
        confidence: analysis.confidence,
        intent: analysis.intent,
        reason: analysis.reason
      },
      status: 'analyzed'
    });

    res.json({
      success: true,
      analysis: {
        isRelevant: analysis.is_relevant,
        confidence: analysis.confidence,
        intent: analysis.intent,
        reason: analysis.reason
      }
    });

  } catch (error) {
    console.error('❌ [API] Erreur analyse:', error);
    res.status(500).json({ 
      error: 'Erreur lors de l\'analyse',
      message: error.message 
    });
  }
});

/**
 * POST /api/ai/generate-response
 * 🤖 Générer une réponse IA
 */
router.post('/generate-response', protect, async (req, res) => {
  try {
    const { messageId, from, subject, body, analysis } = req.body;

    if (!body) {
      return res.status(400).json({ error: 'Corps du message requis' });
    }

    const user = await User.findById(req.user.id);
    
    const messageData = {
      id: messageId,
      from: from || 'inconnu@example.com',
      subject: subject || '',
      body
    };

    const response = await aiService.generateResponse(
      messageData,
      analysis || { is_relevant: true, intent: 'demande_info' },
      user
    );

    // Mettre à jour dans AutoReply
    await AutoReply.findOneAndUpdate(
      { messageId: messageId || Date.now().toString() },
      {
        generatedResponse: response,
        status: 'generated'
      },
      { upsert: true }
    );

    res.json({
      success: true,
      response
    });

  } catch (error) {
    console.error('❌ [API] Erreur génération:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la génération',
      message: error.message 
    });
  }
});

/**
 * POST /api/ai/analyze-and-respond
 * 🎯 Analyser ET générer une réponse (tout en un)
 */
router.post('/analyze-and-respond', protect, async (req, res) => {
  try {
    const { messageId, from, subject, body, source } = req.body;

    if (!body) {
      return res.status(400).json({ error: 'Corps du message requis' });
    }

    const user = await User.findById(req.user.id);
    const settings = await user.getAISettings();

    if (!settings.isEnabled) {
      return res.status(400).json({ error: 'Assistant IA désactivé' });
    }

    const messageData = {
      id: messageId,
      from: from || 'inconnu@example.com',
      subject: subject || '',
      body,
      source: source || 'email'
    };

    // 1️⃣ ANALYSE
    console.log(`🔍 [API] Analyse du message de ${from}`);
    const analysis = await aiService.analyzeMessage(messageData, user);

    // 2️⃣ GÉNÉRATION (si pertinent)
    let response = null;
    if (analysis.is_relevant) {
      console.log(`🤖 [API] Génération de la réponse`);
      response = await aiService.generateResponse(messageData, analysis, user);
    }

    // 3️⃣ SAUVEGARDE
    const autoReply = await AutoReply.create({
      userId: user._id,
      messageId: messageId || Date.now().toString(),
      from: messageData.from,
      subject: messageData.subject,
      body: messageData.body,
      analysis: {
        isRelevant: analysis.is_relevant,
        confidence: analysis.confidence,
        intent: analysis.intent,
        reason: analysis.reason
      },
      generatedResponse: response,
      status: analysis.is_relevant ? 'pending' : 'ignored'
    });

    res.json({
      success: true,
      analysis: {
        isRelevant: analysis.is_relevant,
        confidence: analysis.confidence,
        intent: analysis.intent,
        reason: analysis.reason
      },
      response,
      autoReplyId: autoReply._id
    });

  } catch (error) {
    console.error('❌ [API] Erreur analyse et réponse:', error);
    res.status(500).json({ 
      error: 'Erreur lors du traitement',
      message: error.message 
    });
  }
});

/**
 * POST /api/ai/auto-reply/:messageId/approve
 * ✅ Approuver et envoyer une réponse
 */
router.post('/auto-reply/:messageId/approve', protect, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { response, editedResponse } = req.body;

    const autoReply = await AutoReply.findOne({
      userId: req.user.id,
      messageId
    });

    if (!autoReply) {
      return res.status(404).json({ error: 'Réponse non trouvée' });
    }

    const finalResponse = editedResponse || response || autoReply.generatedResponse;

    // Envoyer l'email
    const sent = await mailService.sendReply({
      to: autoReply.from,
      subject: autoReply.subject ? `Re: ${autoReply.subject}` : 'Re:',
      body: finalResponse,
      originalMessageId: messageId
    });

    if (sent) {
      autoReply.status = 'sent';
      autoReply.sentResponse = finalResponse;
      autoReply.sentAt = new Date();
      await autoReply.save();

      res.json({
        success: true,
        message: 'Réponse envoyée avec succès'
      });
    } else {
      res.status(500).json({ error: 'Échec de l\'envoi' });
    }

  } catch (error) {
    console.error('❌ [API] Erreur approbation:', error);
    res.status(500).json({ 
      error: 'Erreur lors de l\'envoi',
      message: error.message 
    });
  }
});

/**
 * POST /api/ai/auto-reply/:messageId/reject
 * ❌ Rejeter une réponse
 */
router.post('/auto-reply/:messageId/reject', protect, async (req, res) => {
  try {
    const { messageId } = req.params;

    const autoReply = await AutoReply.findOneAndUpdate(
      { userId: req.user.id, messageId },
      { status: 'rejected' },
      { new: true }
    );

    if (!autoReply) {
      return res.status(404).json({ error: 'Réponse non trouvée' });
    }

    res.json({
      success: true,
      message: 'Réponse rejetée'
    });

  } catch (error) {
    console.error('❌ [API] Erreur rejet:', error);
    res.status(500).json({ 
      error: 'Erreur lors du rejet',
      message: error.message 
    });
  }
});

/**
 * GET /api/ai/pending-replies
 * 📋 Obtenir les réponses en attente de validation
 */
router.get('/pending-replies', protect, async (req, res) => {
  try {
    const pendingReplies = await AutoReply.find({
      userId: req.user.id,
      status: 'pending'
    })
    .sort({ createdAt: -1 })
    .limit(50);

    res.json({
      success: true,
      count: pendingReplies.length,
      replies: pendingReplies
    });

  } catch (error) {
    console.error('❌ [API] Erreur récupération:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la récupération',
      message: error.message 
    });
  }
});

/**
 * GET /api/ai/history
 * 📚 Historique des réponses IA
 */
router.get('/history', protect, async (req, res) => {
  try {
    const { limit = 50, status } = req.query;

    const query = { userId: req.user.id };
    if (status) query.status = status;

    const history = await AutoReply.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      count: history.length,
      history
    });

  } catch (error) {
    console.error('❌ [API] Erreur historique:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la récupération de l\'historique',
      message: error.message 
    });
  }
});

/**
 * GET /api/ai/available-slots
 * 📅 Obtenir les créneaux disponibles
 */
router.get('/available-slots', protect, async (req, res) => {
  try {
    const { duration = 60, count = 3 } = req.query;

    const user = await User.findById(req.user.id);
    const slots = await aiService.findAvailableSlots(
      user,
      parseInt(duration),
      parseInt(count)
    );

    res.json({
      success: true,
      count: slots.length,
      slots: slots.map(s => ({
        dateTime: s.toISOString(),
        formatted: s.toLocaleString('fr-FR', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      }))
    });

  } catch (error) {
    console.error('❌ [API] Erreur créneaux:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la recherche de créneaux',
      message: error.message 
    });
  }
});

/**
 * DELETE /api/ai/history/clean
 * 🧹 Nettoyer l'historique ancien (> 30 jours)
 */
router.delete('/history/clean', protect, async (req, res) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);

    const result = await AutoReply.deleteMany({
      userId: req.user.id,
      createdAt: { $lt: cutoffDate },
      status: { $in: ['sent', 'rejected', 'ignored'] }
    });

    res.json({
      success: true,
      deleted: result.deletedCount
    });

  } catch (error) {
    console.error('❌ [API] Erreur nettoyage:', error);
    res.status(500).json({ 
      error: 'Erreur lors du nettoyage',
      message: error.message 
    });
  }
});

module.exports = router;
