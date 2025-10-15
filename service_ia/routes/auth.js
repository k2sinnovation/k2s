const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'votre_secret_jwt_super_securise';

/**
 * POST /api/auth/register
 * Inscription ou connexion d'un utilisateur
 * Body: { deviceId, email, password, businessName }
 */
router.post('/auth/register', async (req, res) => {
  try {
    const { deviceId, email, password, businessName } = req.body;

    // Validation des données
    if (!deviceId || !email || !password || !businessName) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    // Chercher si l'utilisateur existe déjà
    let user = await User.findOne({ deviceId });

    if (user) {
      // Utilisateur existant : vérifier le mot de passe
      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
      }

      // Mettre à jour la date de dernière connexion
      user.lastLoginAt = new Date();
      await user.save();

      console.log(`✅ [Auth] Connexion: ${user.email}`);
    } else {
      // Nouvel utilisateur : créer le compte
      user = await User.create({
        deviceId,
        email,
        password,
        businessName,
      });

      console.log(`✅ [Auth] Nouvel utilisateur: ${user.email}`);
    }

    // Générer le token JWT
    const token = jwt.sign(
      { userId: user._id, deviceId: user.deviceId },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Retourner les données utilisateur et le token
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        businessName: user.businessName,
        subscription: user.subscription,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error('❌ [Auth] Erreur:', error);
    
    // Erreur de duplication (email ou deviceId déjà existant)
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Email ou appareil déjà enregistré' });
    }
    
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * POST /api/auth/login-device
 * Connexion simple avec deviceId uniquement
 * Body: { deviceId }
 */
router.post('/auth/login-device', async (req, res) => {
  try {
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'DeviceId manquant' });
    }

    // Chercher l'utilisateur par deviceId
    const user = await User.findOne({ deviceId });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Mettre à jour la date de dernière connexion
    user.lastLoginAt = new Date();
    await user.save();

    // Générer le token JWT
    const token = jwt.sign(
      { userId: user._id, deviceId: user.deviceId },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log(`✅ [Auth] Connexion deviceId: ${user.email}`);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        businessName: user.businessName,
        subscription: user.subscription,
      },
    });
  } catch (error) {
    console.error('❌ [Auth] Erreur:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * GET /api/auth/me
 * Récupérer les infos de l'utilisateur connecté
 * Header: Authorization Bearer <token>
 */
router.get('/auth/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Token manquant' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Utilisateur non trouvé' });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        businessName: user.businessName,
        subscription: user.subscription,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
    });
  } catch (error) {
    console.error('❌ [Auth] Erreur:', error);
    res.status(401).json({ error: 'Token invalide' });
  }
});

module.exports = router;
