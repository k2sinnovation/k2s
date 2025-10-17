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

/**
 * PUT /api/user/ai-settings
 * 🔄 Synchroniser les paramètres IA
 */
router.put('/ai-settings', protect, async (req, res) => {
  try {
    const user = req.user;

    // ✅ Mise à jour dynamique
    Object.assign(user.aiSettings, req.body);
    user.aiSettings.lastUpdated = new Date();

    await user.save();

    console.log(`✅ [Sync] Paramètres IA mis à jour pour ${user.email}`);

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

/**
 * GET /api/user/ai-settings
 * 📖 Récupérer les paramètres IA
 */
router.get('/ai-settings', protect, async (req, res) => {
  try {
    res.json({
      success: true,
      settings: req.user.aiSettings
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
