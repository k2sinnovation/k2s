const Session = require('../models/Session');
const User = require('../models/User');
const driveCacheMiddleware = require('./drive-cache.middleware');
const driveService = require('../services/google-drive.service');

/**
 * Middleware d'authentification par SESSION TOKEN PERMANENT
 * + Chargement automatique des données Drive
 */
module.exports = async (req, res, next) => {
  const startTime = Date.now();
  
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
    
    // ✅ VÉRIFIER UTILISATEUR ET ABONNEMENT
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
    
    // ✅ ATTACHER LES TOKENS EMAIL
    req.emailAccessToken = session.emailAccessToken || user.emailConfig?.accessToken;
    req.emailRefreshToken = session.emailRefreshToken || user.emailConfig?.refreshToken;
    
    const authDuration = Date.now() - startTime;
    console.log(`✅ [Auth:${req.userId}] Authentifié en ${authDuration}ms`);
    
    // ✅ NOUVEAU : CHARGER DONNÉES DRIVE EN CACHE (NON BLOQUANT)
    if (req.emailAccessToken) {
      try {
        // Vérifier si déjà en cache
        req.driveData = await driveCacheMiddleware.getCachedDriveData(user._id.toString());
        
        if (!req.driveData) {
          // Charger depuis Drive en arrière-plan
          console.log(`[Auth:${req.userId}] 📂 Chargement données Drive...`);
          
          const driveStartTime = Date.now();
          
          const data = await driveService.loadAllUserData(
            req.emailAccessToken, 
            user._id.toString()
          );
          
          const driveDuration = Date.now() - driveStartTime;
          console.log(`[Auth:${req.userId}] ✅ Drive chargé en ${driveDuration}ms`);
          
          req.driveData = data;
          
          // Mettre en cache (async)
          driveCacheMiddleware.cacheUserDriveData(user._id.toString(), data);
        } else {
          console.log(`[Auth:${req.userId}] 📦 Drive depuis cache`);
        }
      } catch (driveError) {
        // Ne pas bloquer si Drive échoue
        console.warn(`[Auth:${req.userId}] ⚠️ Impossible de charger Drive (non bloquant):`, driveError.message);
        req.driveData = null;
      }
    } else {
      console.warn(`[Auth:${req.userId}] ⚠️ Pas de token Gmail, Drive non chargé`);
      req.driveData = null;
    }
    
    const totalDuration = Date.now() - startTime;
    console.log(`✅ [Auth:${req.userId}] Middleware complet en ${totalDuration}ms`);
    
    next();
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ [Auth] Erreur middleware (${duration}ms):`, error.message);
    res.status(500).json({ 
      error: 'Erreur authentification',
      code: 'AUTH_ERROR'
    });
  }
};
