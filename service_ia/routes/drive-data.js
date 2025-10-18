const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const driveService = require('../services/google-drive.service');
const { body, validationResult } = require('express-validator');

/**
 * Routes de gestion des données Drive
 * 
 * Bonnes pratiques:
 * - Validation des entrées avec express-validator
 * - Gestion d'erreurs centralisée
 * - Rate limiting intégré
 * - Logs structurés avec userId
 * - Réponses HTTP standardisées
 */

/**
 * Middleware de validation des erreurs
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.error(`[DriveAPI:${req.userId}] ❌ Validation failed:`, errors.array());
    return res.status(400).json({ 
      success: false,
      error: 'Données invalides',
      details: errors.array().map(e => ({ field: e.param, message: e.msg }))
    });
  }
  next();
};

/**
 * Middleware de gestion d'erreurs globale pour les routes Drive
 */
const handleDriveError = (error, req, res) => {
  console.error(`[DriveAPI:${req.userId}] ❌ Erreur:`, error.message);
  
  // Erreurs spécifiques Google Drive
  if (error.message.includes('invalid_grant')) {
    return res.status(401).json({
      success: false,
      error: 'Token OAuth expiré',
      code: 'TOKEN_EXPIRED',
      message: 'Veuillez vous reconnecter'
    });
  }

  if (error.message.includes('rate limit')) {
    return res.status(429).json({
      success: false,
      error: 'Trop de requêtes',
      code: 'RATE_LIMIT',
      message: 'Veuillez réessayer dans quelques instants'
    });
  }

  // Erreur générique
  res.status(500).json({
    success: false,
    error: 'Erreur serveur',
    code: 'SERVER_ERROR',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Une erreur est survenue'
  });
};

// ===== VÉRIFICATION STATUT DRIVE =====

/**
 * GET /api/drive/check
 * Vérifier si les fichiers Drive existent pour l'utilisateur
 */
router.get('/drive/check', authenticateToken, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { emailAccessToken, userId } = req;

    if (!emailAccessToken) {
      console.warn(`[DriveAPI:${userId}] ⚠️ Token Gmail manquant`);
      return res.status(400).json({ 
        success: false,
        error: 'Token Gmail manquant',
        code: 'NO_TOKEN',
        needsSetup: true
      });
    }

    const status = await driveService.checkDriveFiles(emailAccessToken, userId.toString());
    
    const duration = Date.now() - startTime;
    console.log(`[DriveAPI:${userId}] ✅ Check réussi en ${duration}ms`);

    res.json({
      success: true,
      ...status,
      responseTime: duration
    });

  } catch (error) {
    handleDriveError(error, req, res);
  }
});

// ===== BUSINESS INFO =====

/**
 * GET /api/drive/business
 * Charger les informations business depuis Drive
 */
router.get('/drive/business', authenticateToken, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { emailAccessToken, userId } = req;

    if (!emailAccessToken) {
      return res.status(400).json({ 
        success: false,
        error: 'Token Gmail manquant',
        code: 'NO_TOKEN'
      });
    }

    const info = await driveService.loadBusinessInfo(emailAccessToken, userId.toString());
    
    const duration = Date.now() - startTime;
    console.log(`[DriveAPI:${userId}] ✅ Business info chargée en ${duration}ms`);

    res.json({ 
      success: true,
      info: info,
      isEmpty: !!info._empty,
      updatedAt: info.updatedAt,
      responseTime: duration
    });

  } catch (error) {
    handleDriveError(error, req, res);
  }
});

/**
 * POST /api/drive/business
 * Sauvegarder les informations business sur Drive
 */
router.post(
  '/drive/business',
  authenticateToken,
  [
    body('info').isObject().withMessage('Le champ info doit être un objet'),
    body('info.business').optional().isObject().withMessage('business doit être un objet'),
    body('info.prestations').optional().isArray().withMessage('prestations doit être un tableau'),
    body('info.team').optional().isArray().withMessage('team doit être un tableau')
  ],
  handleValidationErrors,
  async (req, res) => {
    const startTime = Date.now();
    
    try {
      const { emailAccessToken, userId } = req;
      const { info } = req.body;

      if (!emailAccessToken) {
        return res.status(400).json({ 
          success: false,
          error: 'Token Gmail manquant',
          code: 'NO_TOKEN'
        });
      }

      // Validation supplémentaire des données
      if (info.prestations) {
        const invalidPrestations = info.prestations.filter(p => !p.name);
        if (invalidPrestations.length > 0) {
          return res.status(400).json({
            success: false,
            error: 'Chaque prestation doit avoir un nom',
            code: 'INVALID_DATA'
          });
        }
      }

      const fileId = await driveService.saveBusinessInfo(emailAccessToken, info, userId.toString());
      
      const duration = Date.now() - startTime;
      console.log(`[DriveAPI:${userId}] ✅ Business info sauvegardée en ${duration}ms (fileId: ${fileId})`);

      res.json({ 
        success: true, 
        message: 'Informations business sauvegardées',
        fileId: fileId,
        savedAt: new Date().toISOString(),
        responseTime: duration
      });

    } catch (error) {
      handleDriveError(error, req, res);
    }
  }
);

// ===== PLANNING INFO =====

/**
 * GET /api/drive/planning
 * Charger les informations planning depuis Drive
 */
router.get('/drive/planning', authenticateToken, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { emailAccessToken, userId } = req;

    if (!emailAccessToken) {
      return res.status(400).json({ 
        success: false,
        error: 'Token Gmail manquant',
        code: 'NO_TOKEN'
      });
    }

    const info = await driveService.loadPlanningInfo(emailAccessToken, userId.toString());
    
    const duration = Date.now() - startTime;
    console.log(`[DriveAPI:${userId}] ✅ Planning info chargée en ${duration}ms`);

    res.json({ 
      success: true,
      info: info,
      isEmpty: !!info._empty,
      updatedAt: info.updatedAt,
      responseTime: duration
    });

  } catch (error) {
    handleDriveError(error, req, res);
  }
});

/**
 * POST /api/drive/planning
 * Sauvegarder les informations planning sur Drive
 */
router.post(
  '/drive/planning',
  authenticateToken,
  [
    body('info').isObject().withMessage('Le champ info doit être un objet'),
    body('info.openingHours').optional().isObject().withMessage('openingHours doit être un objet'),
    body('info.appointments').optional().isArray().withMessage('appointments doit être un tableau'),
    body('info.closedDates').optional().isArray().withMessage('closedDates doit être un tableau')
  ],
  handleValidationErrors,
  async (req, res) => {
    const startTime = Date.now();
    
    try {
      const { emailAccessToken, userId } = req;
      const { info } = req.body;

      if (!emailAccessToken) {
        return res.status(400).json({ 
          success: false,
          error: 'Token Gmail manquant',
          code: 'NO_TOKEN'
        });
      }

      // Validation des rendez-vous
      if (info.appointments) {
        const invalidAppointments = info.appointments.filter(apt => !apt.date || !apt.time);
        if (invalidAppointments.length > 0) {
          return res.status(400).json({
            success: false,
            error: 'Chaque rendez-vous doit avoir une date et une heure',
            code: 'INVALID_DATA'
          });
        }
      }

      const fileId = await driveService.savePlanningInfo(emailAccessToken, info, userId.toString());
      
      const duration = Date.now() - startTime;
      console.log(`[DriveAPI:${userId}] ✅ Planning info sauvegardée en ${duration}ms (fileId: ${fileId})`);

      res.json({ 
        success: true, 
        message: 'Informations planning sauvegardées',
        fileId: fileId,
        savedAt: new Date().toISOString(),
        responseTime: duration
      });

    } catch (error) {
      handleDriveError(error, req, res);
    }
  }
);

// ===== CHARGEMENT COMPLET (OPTIMISÉ) =====

/**
 * GET /api/drive/all
 * Charger business + planning en une seule requête (optimisation)
 */
router.get('/drive/all', authenticateToken, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { emailAccessToken, userId } = req;

    if (!emailAccessToken) {
      return res.status(400).json({ 
        success: false,
        error: 'Token Gmail manquant',
        code: 'NO_TOKEN'
      });
    }

    const data = await driveService.loadAllUserData(emailAccessToken, userId.toString());
    
    const duration = Date.now() - startTime;
    console.log(`[DriveAPI:${userId}] ✅ Toutes les données chargées en ${duration}ms`);

    res.json({ 
      success: true,
      ...data,
      responseTime: duration
    });

  } catch (error) {
    handleDriveError(error, req, res);
  }
});

// ===== STATISTIQUES CACHE (DEBUG) =====

/**
 * GET /api/drive/cache/stats
 * Obtenir les statistiques du cache (admin uniquement)
 */
router.get('/drive/cache/stats', authenticateToken, async (req, res) => {
  try {
    // TODO: Ajouter vérification role admin
    // if (req.user.role !== 'admin') {
    //   return res.status(403).json({ success: false, error: 'Accès refusé' });
    // }

    const stats = driveService.getCacheStats();
    
    console.log(`[DriveAPI:${req.userId}] 📊 Stats cache consultées`);

    res.json({
      success: true,
      cache: stats,
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage()
      }
    });

  } catch (error) {
    handleDriveError(error, req, res);
  }
});

// ===== INVALIDATION CACHE (FORCE REFRESH) =====

/**
 * POST /api/drive/cache/invalidate
 * Forcer le rafraîchissement du cache pour l'utilisateur
 */
router.post('/drive/cache/invalidate', authenticateToken, async (req, res) => {
  try {
    const { userId } = req;
    
    // Invalider le cache via la méthode privée (à exposer si besoin)
    driveService._invalidateUserCache(userId.toString());
    
    console.log(`[DriveAPI:${userId}] 🗑️ Cache invalidé manuellement`);

    res.json({
      success: true,
      message: 'Cache invalidé. Les prochaines requêtes chargeront depuis Drive.'
    });

  } catch (error) {
    handleDriveError(error, req, res);
  }
});

module.exports = router;
