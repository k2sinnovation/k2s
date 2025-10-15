const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'votre_secret_jwt_super_securise';

/**
 * Middleware d'authentification JWT
 * Vérifie le token dans le header Authorization
 * Ajoute req.user et req.userId si valide
 */
const authenticate = async (req, res, next) => {
  try {
    // Récupérer le token depuis le header
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Token manquant' });
    }

    // Vérifier le token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Récupérer l'utilisateur
    const user = await User.findById(decoded.userId);

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Utilisateur non trouvé ou inactif' });
    }

    // Ajouter l'utilisateur à la requête
    req.user = user;
    req.userId = user._id;

    next();
  } catch (error) {
    console.error('❌ [Auth] Token invalide:', error.message);
    res.status(401).json({ error: 'Token invalide' });
  }
};

module.exports = authenticate;
