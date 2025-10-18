const Session = require('../models/Session');
const User = require('../models/User');

/**
 * Middleware d'authentification par SESSION TOKEN PERMANENT
 * Remplace l'ancien système JWT court
 */
module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('❌ [Auth] Token manquant');
      return res.status(401).json({ 
        error: 'Token manquant',
        code: 'NO_TOKEN'
      });
    }
    
    const sessionToken = authHeader.replace('Bearer ', '');
    const hashedToken = Session.hashToken(sessionToken);
    
    console.log(`🔍 [Auth] Vérification session: ${sessionToken.substring(0, 20)}...`);
    
    // ✅ VÉRIFIER SESSION EN BASE
    const session = await Session.findOne({
      sessionToken: hashedToken,
      isActive: true,
      expiresAt: { $gt: new Date() }
    });
    
    if (!session) {
      console.error('❌ [Auth] Session invalide ou expirée');
      return res.status(401).json({ 
        error: 'Session invalide ou expirée',
        code: 'INVALID_SESSION'
      });
    }
    
    console.log(`✅ [Auth] Session trouvée pour userId=${session.userId}`);
    
    // ✅ VÉRIFIER ABONNEMENT
    const user = await User.findById(session.userId);
    
    if (!user) {
      console.error('❌ [Auth] Utilisateur non trouvé');
      return res.status(401).json({ 
        error: 'Utilisateur non trouvé',
        code: 'USER_NOT_FOUND'
      });
    }
    
    if (!user.subscription.isActive || user.subscription.endDate < new Date()) {
      console.error(`❌ [Auth] Abonnement expiré pour ${user.email}`);
      return res.status(403).json({ 
        error: 'Abonnement expiré',
        code: 'SUBSCRIPTION_EXPIRED',
        endDate: user.subscription.endDate
      });
    }
    
    // ✅ METTRE À JOUR lastUsedAt (async, sans attendre)
    Session.updateOne(
      { _id: session._id },
      { lastUsedAt: new Date() }
    ).exec();
    
    // ✅ ATTACHER INFOS À LA REQUÊTE
    req.userId = user._id;
    req.deviceId = session.deviceId;
    req.session = session;
    req.user = user;
    
    // ✅ ATTACHER LES TOKENS EMAIL SI BESOIN
    req.emailAccessToken = session.emailAccessToken || user.emailConfig?.accessToken;
    req.emailRefreshToken = session.emailRefreshToken || user.emailConfig?.refreshToken;
    
    console.log(`✅ [Auth] Middleware: userId=${req.userId}, device=${req.deviceId}`);
    
    next();
  } catch (error) {
    console.error('❌ [Auth] Middleware erreur:', error.message);
    res.status(500).json({ 
      error: 'Erreur authentification',
      code: 'AUTH_ERROR'
    });
  }
};
