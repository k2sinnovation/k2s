const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'votre_secret_jwt_super_securise';

/**
 * Middleware d'authentification JWT
 * Vérifie le token et ajoute userId à req
 */
module.exports = async (req, res, next) => {
  try {
    // Récupérer le token depuis le header Authorization
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Token manquant ou invalide',
        details: 'Format attendu: "Authorization: Bearer <token>"'
      });
    }

    const token = authHeader.replace('Bearer ', '');

    // Vérifier et décoder le token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Ajouter l'userId à la requête
    req.userId = decoded.userId;
    req.deviceId = decoded.deviceId;

    console.log(`✅ [Auth] Middleware: userId=${req.userId}`);

    next();
  } catch (error) {
    console.error('❌ [Auth] Middleware erreur:', error.message);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token invalide' });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré' });
    }
    
    res.status(401).json({ error: 'Authentification échouée' });
  }
};
