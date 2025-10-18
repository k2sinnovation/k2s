const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Prestation = require('../models/Prestation');
const Appointment = require('../models/Appointment');

// Middleware authentification
const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'Token manquant' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id);
    
    if (!req.user) {
      return res.status(401).json({ error: 'Utilisateur non trouvé' });
    }

    next();
  } catch (error) {
    res.status(401).json({ error: 'Token invalide' });
  }
};

// ========================================
// 🔍 ROUTES DE DEBUG
// ========================================

/**
 * GET /api/user/debug
 * 🔍 Debug : Voir l'état complet de l'utilisateur
 */
router.get('/debug', protect, async (req, res) => {
  try {
    const user = req.user;

    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        businessName: user.businessName,
        deviceId: user.deviceId,
        subscription: user.subscription,
        
        emailConfig: {
          provider: user.emailConfig?.provider || null,
          hasAccessToken: !!user.emailConfig?.accessToken,
          accessTokenLength: user.emailConfig?.accessToken?.length || 0,
          email: user.emailConfig?.email || null,
          connectedAt: user.emailConfig?.connectedAt || null,
        },
        
        aiSettings: {
          isEnabled: user.aiSettings?.isEnabled || false,
          autoReplyEnabled: user.aiSettings?.autoReplyEnabled || false,
          requireValidation: user.aiSettings?.requireValidation !== false, // true par défaut
          salonName: user.aiSettings?.salonName || '',
          ownerEmail: user.aiSettings?.ownerEmail || '',
          ownerPhone: user.aiSettings?.ownerPhone || '',
          role: user.aiSettings?.role || '',
          instructions: user.aiSettings?.instructions || '',
          tone: user.aiSettings?.tone || '',
          hasApiKey: !!user.aiSettings?.apiKey,
          apiKeyLength: user.aiSettings?.apiKey?.length || 0,
          aiModel: user.aiSettings?.aiModel || '',
          temperature: user.aiSettings?.temperature || 0,
          maxTokens: user.aiSettings?.maxTokens || 0,
          lastUpdated: user.aiSettings?.lastUpdated || null,
        },

        // ✅ Critères pour être "actif" dans le polling
        pollingCriteria: {
          isEnabled: user.aiSettings?.isEnabled === true,
          autoReplyEnabled: user.aiSettings?.autoReplyEnabled === true,
          hasAccessToken: !!user.emailConfig?.accessToken,
          willBeProcessed: (
            user.aiSettings?.isEnabled === true &&
            user.aiSettings?.autoReplyEnabled === true &&
            !!user.emailConfig?.accessToken
          )
        }
      }
    });

  } catch (error) {
    console.error('❌ [Debug] Erreur:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/user/debug/all-users
 * 🔍 Debug : Voir TOUS les utilisateurs (ADMIN)
 */
router.get('/debug/all-users', async (req, res) => {
  try {
    const users = await User.find({}, {
      email: 1,
      businessName: 1,
      'emailConfig.provider': 1,
      'emailConfig.email': 1,
      'aiSettings.isEnabled': 1,
      'aiSettings.autoReplyEnabled': 1,
      'aiSettings.salonName': 1,
    });

    const activeUsers = await User.find({
      'aiSettings.isEnabled': true,
      'aiSettings.autoReplyEnabled': true,
      'emailConfig.accessToken': { $exists: true }
    });

    res.json({
      success: true,
      totalUsers: users.length,
      activeUsersForPolling: activeUsers.length,
      users: users.map(u => ({
        id: u._id,
        email: u.email,
        businessName: u.businessName,
        emailProvider: u.emailConfig?.provider || 'none',
        emailConnected: u.emailConfig?.email || 'none',
        aiEnabled: u.aiSettings?.isEnabled || false,
        autoReplyEnabled: u.aiSettings?.autoReplyEnabled || false,
        salonName: u.aiSettings?.salonName || '',
      })),
      activeUsers: activeUsers.map(u => ({
        email: u.email,
        salonName: u.aiSettings?.salonName,
      }))
    });

  } catch (error) {
    console.error('❌ [Debug] Erreur:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/user/debug/force-activate
 * 🔧 Debug : Forcer l'activation de l'auto-reply
 */
router.post('/debug/force-activate', protect, async (req, res) => {
  try {
    const user = req.user;

    // ✅ Activer tout
    user.aiSettings = user.aiSettings || {};
    user.aiSettings.isEnabled = true;
    user.aiSettings.autoReplyEnabled = true;
    user.aiSettings.requireValidation = false;

    if (!user.aiSettings.salonName) {
      user.aiSettings.salonName = user.businessName || 'Mon Entreprise';
    }
    if (!user.aiSettings.role) {
      user.aiSettings.role = 'Assistant virtuel pour la gestion des rendez-vous';
    }
    if (!user.aiSettings.instructions) {
      user.aiSettings.instructions = 'Sois professionnel et courtois. Réponds uniquement aux demandes liées à mon activité.';
    }
    if (!user.aiSettings.tone) {
      user.aiSettings.tone = 'professionnel';
    }

    await user.save();

    console.log(`✅ [Debug] Auto-reply forcé pour ${user.email}`);

    res.json({
      success: true,
      message: 'Auto-reply activé de force',
      user: {
        email: user.email,
        aiSettings: {
          isEnabled: user.aiSettings.isEnabled,
          autoReplyEnabled: user.aiSettings.autoReplyEnabled,
          requireValidation: user.aiSettings.requireValidation,
          salonName: user.aiSettings.salonName,
        },
        hasEmailToken: !!user.emailConfig?.accessToken,
      }
    });

  } catch (error) {
    console.error('❌ [Debug] Erreur:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// 📤 ROUTES DE SYNCHRONISATION
// ========================================

/**
 * PUT /api/user/ai-settings
 * 🔄 Synchroniser les paramètres IA
 */
router.put('/ai-settings', protect, async (req, res) => {
  try {
    const user = req.user;

    // ✅ Mise à jour dynamique
    if (!user.aiSettings) {
      user.aiSettings = {};
    }
    
    Object.assign(user.aiSettings, req.body);
    user.aiSettings.lastUpdated = new Date();

    await user.save();

    console.log(`✅ [Sync] Paramètres IA mis à jour pour ${user.email}`);
    console.log(`   - isEnabled: ${user.aiSettings.isEnabled}`);
    console.log(`   - autoReplyEnabled: ${user.aiSettings.autoReplyEnabled}`);
    console.log(`   - salonName: ${user.aiSettings.salonName}`);

    res.json({
      success: true,
      message: 'Paramètres synchronisés',
      settings: user.aiSettings
    });

  } catch (error) {
    console.error('❌ [Sync] Erreur:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/user/email-config
 * 🔄 Synchroniser la configuration email
 */
router.put('/email-config', protect, async (req, res) => {
  try {
    const user = req.user;
    const { provider, accessToken, refreshToken, email } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: 'accessToken requis' });
    }

    // Mettre à jour
    user.emailConfig = {
      provider: provider || user.emailConfig?.provider,
      accessToken,
      refreshToken: refreshToken || user.emailConfig?.refreshToken,
      email: email || user.emailConfig?.email,
      connectedAt: new Date()
    };

    await user.save();

    console.log(`✅ [Sync] Email config mise à jour pour ${user.email}`);
    console.log(`   - Provider: ${user.emailConfig.provider}`);
    console.log(`   - Email: ${user.emailConfig.email}`);

    res.json({
      success: true,
      message: 'Configuration email synchronisée',
      emailConfig: {
        provider: user.emailConfig.provider,
        email: user.emailConfig.email,
        hasAccessToken: !!user.emailConfig.accessToken,
      }
    });

  } catch (error) {
    console.error('❌ [Sync] Erreur:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/user/prestations
 * 🔄 Synchroniser une prestation
 */
router.put('/prestations', protect, async (req, res) => {
  try {
    const { id, ...data } = req.body;

    await Prestation.findOneAndUpdate(
      { userId: req.user._id, id },
      { $set: { ...data, userId: req.user._id } },
      { upsert: true, new: true }
    );

    console.log(`✅ [Sync] Prestation ${id} synchronisée pour ${req.user.email}`);

    res.json({ success: true });

  } catch (error) {
    console.error('❌ [Sync] Erreur:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/user/appointments
 * 🔄 Synchroniser un rendez-vous
 */
router.put('/appointments', protect, async (req, res) => {
  try {
    const { id, ...data } = req.body;

    await Appointment.findOneAndUpdate(
      { userId: req.user._id, id },
      { $set: { ...data, userId: req.user._id } },
      { upsert: true, new: true }
    );

    console.log(`✅ [Sync] RDV ${id} synchronisé pour ${req.user.email}`);

    res.json({ success: true });

  } catch (error) {
    console.error('❌ [Sync] Erreur:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// 📖 ROUTES DE LECTURE
// ========================================

/**
 * GET /api/user/ai-settings
 * 📖 Récupérer les paramètres IA
 */
router.get('/ai-settings', protect, async (req, res) => {
  try {
    res.json({
      success: true,
      settings: req.user.aiSettings || {}
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
