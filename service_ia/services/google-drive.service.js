const axios = require('axios');
const NodeCache = require('node-cache');

/**
 * Service de gestion Google Drive (appDataFolder)
 * 
 * Bonnes pratiques appliquées:
 * - Cache en mémoire avec TTL (Time To Live)
 * - Gestion d'erreurs complète
 * - Logs structurés avec userId
 * - Retry automatique sur échec
 * - Rate limiting considéré
 * - Thread-safe (pas de variables globales mutables)
 */
class GoogleDriveService {
  constructor() {
    // Cache en mémoire : 5 minutes TTL, vérification toutes les 60s
    this.cache = new NodeCache({ 
      stdTTL: 300, 
      checkperiod: 60,
      useClones: false // Performance: pas de deep clone
    });
    
    // Configuration retry
    this.retryConfig = {
      maxRetries: 3,
      retryDelay: 1000, // 1 seconde
      retryableStatuses: [429, 500, 502, 503, 504]
    };
  }

  /**
   * Sauvegarder un fichier JSON dans appDataFolder
   * @param {string} accessToken - Token OAuth Google
   * @param {string} fileName - Nom du fichier
   * @param {Object} jsonData - Données à sauvegarder
   * @param {string} userId - ID utilisateur (pour logs/cache)
   * @returns {Promise<string>} - ID du fichier Drive
   */
  async saveJsonToAppData(accessToken, fileName, jsonData, userId = 'unknown') {
    const startTime = Date.now();
    
    try {
      console.log(`[Drive:${userId}] 📤 Sauvegarde ${fileName}...`);

      // Validation des paramètres
      if (!accessToken) {
        throw new Error('Access token manquant');
      }
      if (!fileName || typeof fileName !== 'string') {
        throw new Error('Nom de fichier invalide');
      }
      if (!jsonData || typeof jsonData !== 'object') {
        throw new Error('Données JSON invalides');
      }

      // Vérifier si le fichier existe déjà
      const existingFile = await this._findFileInAppData(accessToken, fileName, userId);

      const boundary = '-------314159265358979323846';
      const delimiter = "\r\n--" + boundary + "\r\n";
      const close_delim = "\r\n--" + boundary + "--";

      const metadata = {
        name: fileName,
        mimeType: 'application/json',
        ...(!existingFile && { parents: ['appDataFolder'] })
      };

      // Préparer le body multipart
      const multipartRequestBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(jsonData, null, 2) +
        close_delim;

      let url, method;
      
      if (existingFile) {
        url = `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=multipart`;
        method = 'patch';
      } else {
        url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
        method = 'post';
      }

      // Effectuer la requête avec retry
      const response = await this._executeWithRetry(
        () => axios({
          method,
          url,
          data: multipartRequestBody,
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`
          },
          timeout: 30000
        }),
        userId
      );

      const duration = Date.now() - startTime;
      console.log(`[Drive:${userId}] ✅ ${fileName} ${existingFile ? 'mis à jour' : 'créé'} en ${duration}ms`);

      // Invalider le cache pour cet utilisateur
      this._invalidateUserCache(userId, fileName);

      return response.data.id;

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[Drive:${userId}] ❌ Erreur sauvegarde ${fileName} (${duration}ms):`, this._formatError(error));
      throw new Error(`Impossible de sauvegarder ${fileName}: ${error.message}`);
    }
  }

  /**
   * Lire un fichier JSON depuis appDataFolder
   * @param {string} accessToken - Token OAuth Google
   * @param {string} fileName - Nom du fichier
   * @param {string} userId - ID utilisateur
   * @returns {Promise<Object|null>} - Contenu JSON ou null
   */
  async readJsonFromAppData(accessToken, fileName, userId = 'unknown') {
    const startTime = Date.now();
    
    try {
      // Vérifier le cache d'abord
      const cacheKey = `${userId}:${fileName}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached) {
        console.log(`[Drive:${userId}] 📦 ${fileName} depuis cache`);
        return cached;
      }

      console.log(`[Drive:${userId}] 📥 Lecture ${fileName}...`);

      // Validation
      if (!accessToken) {
        throw new Error('Access token manquant');
      }

      // Trouver le fichier
      const file = await this._findFileInAppData(accessToken, fileName, userId);

      if (!file) {
        console.log(`[Drive:${userId}] ℹ️ ${fileName} non trouvé (première utilisation)`);
        return null;
      }

      // Télécharger le contenu avec retry
      const response = await this._executeWithRetry(
        () => axios.get(
          `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
          {
            headers: { 'Authorization': `Bearer ${accessToken}` },
            timeout: 30000
          }
        ),
        userId
      );

      const duration = Date.now() - startTime;
      console.log(`[Drive:${userId}] ✅ ${fileName} lu en ${duration}ms`);

      // Mettre en cache
      this.cache.set(cacheKey, response.data);

      return response.data;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Ne pas logger en erreur si fichier simplement absent
      if (error.response?.status === 404) {
        console.log(`[Drive:${userId}] ℹ️ ${fileName} introuvable (${duration}ms)`);
        return null;
      }

      console.error(`[Drive:${userId}] ❌ Erreur lecture ${fileName} (${duration}ms):`, this._formatError(error));
      return null;
    }
  }

  /**
   * Charger les informations business
   * @param {string} accessToken
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  async loadBusinessInfo(accessToken, userId) {
    const data = await this.readJsonFromAppData(accessToken, 'business_info.json', userId);
    
    // Toujours retourner un objet avec au moins updatedAt
    return data || { 
      updatedAt: new Date().toISOString(),
      _empty: true 
    };
  }

  /**
   * Sauvegarder les informations business
   * @param {string} accessToken
   * @param {Object} info
   * @param {string} userId
   * @returns {Promise<string>}
   */
  async saveBusinessInfo(accessToken, info, userId) {
    // Validation des données critiques
    if (info && typeof info !== 'object') {
      throw new Error('Format business_info invalide');
    }

    const data = {
      ...info,
      updatedAt: new Date().toISOString(),
      _version: '1.0'
    };

    // Nettoyer les champs vides (optionnel)
    delete data._empty;

    return await this.saveJsonToAppData(accessToken, 'business_info.json', data, userId);
  }

  /**
   * Charger les informations planning
   * @param {string} accessToken
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  async loadPlanningInfo(accessToken, userId) {
    const data = await this.readJsonFromAppData(accessToken, 'planning_info.json', userId);
    
    return data || { 
      updatedAt: new Date().toISOString(),
      _empty: true 
    };
  }

  /**
   * Sauvegarder les informations planning
   * @param {string} accessToken
   * @param {Object} info
   * @param {string} userId
   * @returns {Promise<string>}
   */
  async savePlanningInfo(accessToken, info, userId) {
    if (info && typeof info !== 'object') {
      throw new Error('Format planning_info invalide');
    }

    const data = {
      ...info,
      updatedAt: new Date().toISOString(),
      _version: '1.0'
    };

    delete data._empty;

    return await this.saveJsonToAppData(accessToken, 'planning_info.json', data, userId);
  }

  /**
   * Vérifier l'existence des fichiers Drive
   * @param {string} accessToken
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  async checkDriveFiles(accessToken, userId = 'unknown') {
    try {
      console.log(`[Drive:${userId}] 🔍 Vérification fichiers...`);

      const [businessFile, planningFile] = await Promise.all([
        this._findFileInAppData(accessToken, 'business_info.json', userId).catch(() => null),
        this._findFileInAppData(accessToken, 'planning_info.json', userId).catch(() => null)
      ]);

      const status = {
        businessExists: !!businessFile,
        planningExists: !!planningFile,
        needsSetup: !businessFile && !planningFile,
        lastChecked: new Date().toISOString()
      };

      console.log(`[Drive:${userId}] ✅ Business: ${status.businessExists}, Planning: ${status.planningExists}`);

      return status;

    } catch (error) {
      console.error(`[Drive:${userId}] ❌ Erreur vérification:`, this._formatError(error));
      
      return {
        businessExists: false,
        planningExists: false,
        needsSetup: true,
        error: error.message
      };
    }
  }

  /**
   * Charger les deux fichiers en parallèle (optimisation)
   * @param {string} accessToken
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  async loadAllUserData(accessToken, userId) {
    const startTime = Date.now();
    
    try {
      console.log(`[Drive:${userId}] 📥 Chargement complet...`);

      const [businessInfo, planningInfo] = await Promise.all([
        this.loadBusinessInfo(accessToken, userId),
        this.loadPlanningInfo(accessToken, userId)
      ]);

      const duration = Date.now() - startTime;
      console.log(`[Drive:${userId}] ✅ Données chargées en ${duration}ms`);

      return {
        businessInfo,
        planningInfo,
        loadedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error(`[Drive:${userId}] ❌ Erreur chargement complet:`, this._formatError(error));
      throw error;
    }
  }

  /**
   * MÉTHODES PRIVÉES
   */

  /**
   * Trouver un fichier dans appDataFolder
   * @private
   */
  async _findFileInAppData(accessToken, fileName, userId) {
    try {
      const response = await axios.get(
        'https://www.googleapis.com/drive/v3/files',
        {
          headers: { 'Authorization': `Bearer ${accessToken}` },
          params: {
            q: `name='${fileName}' and 'appDataFolder' in parents and trashed=false`,
            spaces: 'appDataFolder',
            fields: 'files(id, name, createdTime, modifiedTime, size)',
            pageSize: 1
          },
          timeout: 15000
        }
      );

      return response.data.files.length > 0 ? response.data.files[0] : null;

    } catch (error) {
      // Si erreur 404 sur appDataFolder, c'est normal (première utilisation)
      if (error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Exécuter une requête avec retry automatique
   * @private
   */
  async _executeWithRetry(requestFn, userId, attempt = 1) {
    try {
      return await requestFn();
      
    } catch (error) {
      const status = error.response?.status;
      const isRetryable = this.retryConfig.retryableStatuses.includes(status);
      
      if (isRetryable && attempt < this.retryConfig.maxRetries) {
        const delay = this.retryConfig.retryDelay * attempt;
        console.log(`[Drive:${userId}] ⏳ Retry ${attempt}/${this.retryConfig.maxRetries} dans ${delay}ms...`);
        
        await this._sleep(delay);
        return this._executeWithRetry(requestFn, userId, attempt + 1);
      }
      
      throw error;
    }
  }

  /**
   * Invalider le cache d'un utilisateur
   * @private
   */
  _invalidateUserCache(userId, fileName = null) {
    if (fileName) {
      const cacheKey = `${userId}:${fileName}`;
      this.cache.del(cacheKey);
      console.log(`[Drive:${userId}] 🗑️ Cache invalidé: ${fileName}`);
    } else {
      // Invalider tout le cache de l'utilisateur
      const keys = this.cache.keys();
      const userKeys = keys.filter(key => key.startsWith(`${userId}:`));
      this.cache.del(userKeys);
      console.log(`[Drive:${userId}] 🗑️ Cache complet invalidé (${userKeys.length} entrées)`);
    }
  }

  /**
   * Formater les erreurs pour les logs
   * @private
   */
  _formatError(error) {
    if (error.response) {
      return {
        status: error.response.status,
        data: error.response.data,
        message: error.message
      };
    }
    return {
      message: error.message,
      code: error.code
    };
  }

  /**
   * Sleep helper pour retry
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Obtenir les statistiques du cache
   * @returns {Object}
   */
  getCacheStats() {
    return {
      keys: this.cache.keys().length,
      hits: this.cache.getStats().hits,
      misses: this.cache.getStats().misses,
      size: this.cache.getStats().ksize
    };
  }
}

// Export singleton
module.exports = new GoogleDriveService();
