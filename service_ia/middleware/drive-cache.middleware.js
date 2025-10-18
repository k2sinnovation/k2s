const NodeCache = require('node-cache');

/**
 * Middleware de cache pour les données Drive
 * 
 * Bonnes pratiques:
 * - Cache en mémoire avec expiration
 * - Invalidation automatique sur modification
 * - Thread-safe pour multi-utilisateurs
 * - Optimisation des performances
 */
class DriveCacheMiddleware {
  constructor() {
    // Cache dédié pour les données complètes utilisateur
    // TTL: 10 minutes (600s)
    this.userDataCache = new NodeCache({ 
      stdTTL: 600, 
      checkperiod: 120,
      useClones: false
    });

    // Statistiques
    this.stats = {
      hits: 0,
      misses: 0,
      invalidations: 0
    };
  }

  /**
   * Mettre en cache les données Drive d'un utilisateur
   * @param {string} userId
   * @param {Object} data - { businessInfo, planningInfo }
   */
  async cacheUserDriveData(userId, data) {
    try {
      const cacheKey = `user:${userId}:driveData`;
      
      const cacheData = {
        ...data,
        cachedAt: new Date().toISOString()
      };

      this.userDataCache.set(cacheKey, cacheData);
      
      console.log(`[DriveCache] 💾 Données mises en cache pour user ${userId}`);
      
      return true;
    } catch (error) {
      console.error(`[DriveCache] ❌ Erreur cache pour user ${userId}:`, error.message);
      return false;
    }
  }

  /**
   * Récupérer les données Drive du cache
   * @param {string} userId
   * @returns {Object|null}
   */
  async getCachedDriveData(userId) {
    try {
      const cacheKey = `user:${userId}:driveData`;
      const cached = this.userDataCache.get(cacheKey);

      if (cached) {
        this.stats.hits++;
        console.log(`[DriveCache] ✅ Cache hit pour user ${userId}`);
        return cached;
      }

      this.stats.misses++;
      console.log(`[DriveCache] ❌ Cache miss pour user ${userId}`);
      return null;

    } catch (error) {
      console.error(`[DriveCache] ❌ Erreur lecture cache pour user ${userId}:`, error.message);
      return null;
    }
  }

  /**
   * Invalider le cache d'un utilisateur
   * @param {string} userId
   */
  invalidateCache(userId) {
    try {
      const cacheKey = `user:${userId}:driveData`;
      const deleted = this.userDataCache.del(cacheKey);
      
      if (deleted > 0) {
        this.stats.invalidations++;
        console.log(`[DriveCache] 🗑️ Cache invalidé pour user ${userId}`);
      }

      return deleted > 0;
    } catch (error) {
      console.error(`[DriveCache] ❌ Erreur invalidation cache pour user ${userId}:`, error.message);
      return false;
    }
  }

  /**
   * Middleware Express: Attacher les données Drive à req.driveData
   * Usage: router.get('/route', driveCacheMiddleware.middleware, handler)
   */
  middleware = async (req, res, next) => {
    try {
      const userId = req.userId?.toString();
      
      if (!userId) {
        console.warn('[DriveCache] ⚠️ userId manquant dans req');
        req.driveData = null;
        return next();
      }

      // Essayer de récupérer depuis le cache
      const cached = await this.getCachedDriveData(userId);

      if (cached) {
        req.driveData = cached;
        console.log(`[DriveCache:${userId}] 📦 Données attachées depuis cache`);
      } else {
        req.driveData = null;
        console.log(`[DriveCache:${userId}] ℹ️ Pas de données en cache`);
      }

      next();

    } catch (error) {
      console.error('[DriveCache] ❌ Erreur middleware:', error.message);
      req.driveData = null;
      next();
    }
  };

  /**
   * Obtenir les statistiques du cache
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      hitRate: this.stats.hits + this.stats.misses > 0 
        ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2) + '%'
        : '0%',
      cacheSize: this.userDataCache.keys().length,
      keys: this.userDataCache.keys()
    };
  }

  /**
   * Nettoyer complètement le cache (maintenance)
   */
  flushAll() {
    const count = this.userDataCache.keys().length;
    this.userDataCache.flushAll();
    console.log(`[DriveCache] 🧹 Cache complet vidé (${count} entrées)`);
    return count;
  }
}

// Export singleton
module.exports = new DriveCacheMiddleware();
