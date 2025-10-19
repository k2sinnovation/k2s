const Session = require('../models/Session');
const User = require('../models/User');
const driveCacheMiddleware = require('./drive-cache.middleware');
const driveService = require('../services/google-drive.service');

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
    
    const user = await User.findById(session.userId);
    
    if (!user) {
      console.error('❌ [Auth] Utilisateur non trouvé');
      return res.status(401).json({ 
        error: 'Utilisateur non trouvé',
        code: 'USER_NOT_FOUND'
      });
    }
    
    // ✅ CORRECTION : Bypass abonnement pour routes Drive
    const isDriveRoute = req.path.startsWith('/drive');
    
    if (!isDriveRoute) {
      if (!user.subscription.isActive || user.subscription.endDate < new Date()) {
        console.error(`❌ [Auth] Abonnement expiré pour ${user.email}`);
        return res.status(403).json({ 
          error: 'Abonnement expiré',
          code: 'SUBSCRIPTION_EXPIRED',
          endDate: user.subscription.endDate
        });
      }
    } else {
      console.log(`✅ [Auth:Drive] ${user.email} - ${req.method} ${req.path}`);
    }
    
    Session.updateOne(
      { _id: session._id },
      { lastUsedAt: new Date() }
    ).exec();
    
    req.userId = user._id;
    req.deviceId = session.deviceId;
    req.session = session;
    req.user = user;
    req.emailAccessToken = session.emailAccessToken || user.emailConfig?.accessToken;
    req.emailRefreshToken = session.emailRefreshToken || user.emailConfig?.refreshToken;
    
    const authDuration = Date.now() - startTime;
    console.log(`✅ [Auth:${req.userId}] Authentifié en ${authDuration}ms`);
    
    if (isDriveRoute) {
      console.log(`   📂 Token Gmail: ${req.emailAccessToken ? '✅ Présent' : '❌ Absent'}`);
    }
    
    if (!isDriveRoute && req.emailAccessToken) {
      try {
        req.driveData = await driveCacheMiddleware.getCachedDriveData(user._id.toString());
        
        if (!req.driveData) {
          console.log(`[Auth:${req.userId}] 📂 Chargement données Drive...`);
          const driveStartTime = Date.now();
          const data = await driveService.loadAllUserData(req.emailAccessToken, user._id.toString());
          const driveDuration = Date.now() - driveStartTime;
          console.log(`[Auth:${req.userId}] ✅ Drive chargé en ${driveDuration}ms`);
          req.driveData = data;
          driveCacheMiddleware.cacheUserDriveData(user._id.toString(), data);
        } else {
          console.log(`[Auth:${req.userId}] 📦 Drive depuis cache`);
        }
      } catch (driveError) {
        console.warn(`[Auth:${req.userId}] ⚠️ Drive non chargé:`, driveError.message);
        req.driveData = null;
      }
    }
    
    const totalDuration = Date.now() - startTime;
    console.log(`✅ [Auth:${req.userId}] Middleware complet en ${totalDuration}ms`);
    
    next();
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ [Auth] Erreur (${duration}ms):`, error.message);
    res.status(500).json({ 
      error: 'Erreur authentification',
      code: 'AUTH_ERROR'
    });
  }
};
