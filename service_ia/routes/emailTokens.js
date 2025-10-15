const express = require('express');
const router = express.Router();
const EmailAccount = require('../models/EmailAccount');
const authenticate = require('../middleware/authenticate');

/**
 * POST /api/auth/save-tokens
 * Sauvegarder les tokens OAuth depuis Flutter
 * Header: Authorization Bearer <JWT>
 * Body: { provider, access_token, refresh_token, email }
 */
router.post('/auth/save-tokens', authenticate, async (req, res) => {
  try {
    const { provider, access_token, refresh_token, email } = req.body;

    // Validation des données
    if (!provider || !access_token || !refresh_token || !email) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    if (!['gmail', 'outlook'].includes(provider)) {
      return res.status(400).json({ error: 'Provider invalide (gmail ou outlook)' });
    }

    const userId = req.userId; // Depuis le middleware authenticate

    // Calculer l'expiration du token (1 heure par défaut)
    const expiresAt = new Date(Date.now() + 3600 * 1000);

    // Upsert : créer ou mettre à jour le compte
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
        upsert: true, // Créer si n'existe pas
        new: true,    // Retourner le document mis à jour
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
 * Récupérer tous les comptes email de l'utilisateur
 * Header: Authorization Bearer <JWT>
 */
router.get('/auth/email-accounts', authenticate, async (req, res) => {
  try {
    const accounts = await EmailAccount.find({
      userId: req.userId,
      isActive: true,
    }).select('-accessToken -refreshToken'); // Ne pas renvoyer les tokens

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
 * GET /api/auth/email-accounts/:accountId
 * Récupérer un compte email spécifique
 * Header: Authorization Bearer <JWT>
 */
router.get('/auth/email-accounts/:accountId', authenticate, async (req, res) => {
  try {
    const account = await EmailAccount.findOne({
      _id: req.params.accountId,
      userId: req.userId,
    }).select('-accessToken -refreshToken');

    if (!account) {
      return res.status(404).json({ error: 'Compte non trouvé' });
    }

    res.json({
      success: true,
      account: {
        id: account._id,
        provider: account.provider,
        email: account.email,
        isActive: account.isActive,
        aiSettings: account.aiSettings,
        stats: account.stats,
        lastCheckedAt: account.lastCheckedAt,
        createdAt: account.createdAt,
      },
    });
  } catch (error) {
    console.error('❌ [Backend] Erreur:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * DELETE /api/auth/email-accounts/:accountId
 * Déconnecter (désactiver) un compte email
 * Header: Authorization Bearer <JWT>
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
 * Mettre à jour les paramètres IA d'un compte
 * Header: Authorization Bearer <JWT>
 * Body: { autoReply, replyDelay, customInstructions, workingHours }
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

/**
 * GET /api/auth/email-accounts/:accountId/stats
 * Récupérer les statistiques d'un compte
 * Header: Authorization Bearer <JWT>
 */
router.get('/auth/email-accounts/:accountId/stats', authenticate, async (req, res) => {
  try {
    const account = await EmailAccount.findOne({
      _id: req.params.accountId,
      userId: req.userId,
    }).select('email provider stats lastCheckedAt');

    if (!account) {
      return res.status(404).json({ error: 'Compte non trouvé' });
    }

    res.json({
      success: true,
      email: account.email,
      provider: account.provider,
      stats: account.stats,
      lastCheckedAt: account.lastCheckedAt,
    });
  } catch (error) {
    console.error('❌ [Backend] Erreur statistiques:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
