const express = require('express');
const router = express.Router();
const EmailAccount = require('../models/EmailAccount');
const authenticate = require('../middleware/authenticate');

/**
 * POST /api/auth/save-tokens
 * Sauvegarder les tokens OAuth depuis Flutter
 */
router.post('/auth/save-tokens', authenticate, async (req, res) => {
  try {
    const { provider, access_token, refresh_token, email } = req.body;

    if (!provider || !access_token || !refresh_token || !email) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    if (!['gmail', 'outlook'].includes(provider)) {
      return res.status(400).json({ error: 'Provider invalide (gmail ou outlook)' });
    }

    const userId = req.userId;
    const expiresAt = new Date(Date.now() + 3600 * 1000);

    const emailAccount = await EmailAccount.findOneAndUpdate(
      { userId, provider, email },
      {
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiresAt: expiresAt,
        isActive: true,
        updatedAt: new Date(),
      },
      {
        upsert: true,
        new: true,
      }
    );

    console.log(`✅ [Backend] Tokens ${provider} sauvegardés pour user ${userId} (${email})`);

    res.json({
      success: true,
      message: 'Tokens sauvegardés avec succès',
      accountId: emailAccount._id,
      provider: emailAccount.provider,
      email: emailAccount.email,
    });
  } catch (error) {
    console.error('❌ [Backend] Erreur sauvegarde tokens:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * GET /api/auth/email-accounts
 */
router.get('/auth/email-accounts', authenticate, async (req, res) => {
  try {
    const accounts = await EmailAccount.find({
      userId: req.userId,
      isActive: true,
    }).select('-accessToken -refreshToken');

    res.json({
      success: true,
      count: accounts.length,
      accounts: accounts.map((acc) => ({
        id: acc._id,
        provider: acc.provider,
        email: acc.email,
        autoReply: acc.aiSettings.autoReply,
        replyDelay: acc.aiSettings.replyDelay,
        customInstructions: acc.aiSettings.customInstructions,
        workingHours: acc.aiSettings.workingHours,
        stats: acc.stats,
        lastCheckedAt: acc.lastCheckedAt,
        createdAt: acc.createdAt,
      })),
    });
  } catch (error) {
    console.error('❌ [Backend] Erreur récupération comptes:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * DELETE /api/auth/email-accounts/:accountId
 */
router.delete('/auth/email-accounts/:accountId', authenticate, async (req, res) => {
  try {
    const account = await EmailAccount.findOneAndUpdate(
      { _id: req.params.accountId, userId: req.userId },
      { isActive: false, updatedAt: new Date() },
      { new: true }
    );

    if (!account) {
      return res.status(404).json({ error: 'Compte non trouvé' });
    }

    console.log(`✅ [Backend] Compte ${account.email} déconnecté`);

    res.json({
      success: true,
      message: 'Compte déconnecté avec succès',
    });
  } catch (error) {
    console.error('❌ [Backend] Erreur déconnexion:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * PATCH /api/auth/email-accounts/:accountId/settings
 */
router.patch('/auth/email-accounts/:accountId/settings', authenticate, async (req, res) => {
  try {
    const { autoReply, replyDelay, customInstructions, workingHours } = req.body;

    const updateData = {};
    if (autoReply !== undefined) updateData['aiSettings.autoReply'] = autoReply;
    if (replyDelay !== undefined) updateData['aiSettings.replyDelay'] = replyDelay;
    if (customInstructions !== undefined) updateData['aiSettings.customInstructions'] = customInstructions;
    if (workingHours !== undefined) updateData['aiSettings.workingHours'] = workingHours;
    updateData.updatedAt = new Date();

    const account = await EmailAccount.findOneAndUpdate(
      { _id: req.params.accountId, userId: req.userId },
      { $set: updateData },
      { new: true }
    ).select('aiSettings email provider');

    if (!account) {
      return res.status(404).json({ error: 'Compte non trouvé' });
    }

    console.log(`✅ [Backend] Paramètres IA mis à jour pour ${account.email}`);

    res.json({
      success: true,
      message: 'Paramètres mis à jour avec succès',
      settings: account.aiSettings,
    });
  } catch (error) {
    console.error('❌ [Backend] Erreur mise à jour paramètres:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
