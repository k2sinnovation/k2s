const axios = require('axios');
const NodeCache = require('node-cache');

/**
 * Service de gestion Google Drive (appDataFolder)
 * ✅ AVEC REFRESH AUTOMATIQUE DU TOKEN
 */
class GoogleDriveService {
  constructor() {
    this.cache = new NodeCache({ 
      stdTTL: 300, 
      checkperiod: 60,
      useClones: false
    });
    
    this.retryConfig = {
      maxRetries: 3,
      retryDelay: 1000,
      retryableStatuses: [429, 500, 502, 503, 504]
    };

    // ✅ NOUVEAU : Credentials Google OAuth
    this.googleClientId = process.env.GOOGLE_CLIENT_ID || '461385830578-pbnq271ga15ggms5c4uckspo4480litm.apps.googleusercontent.com';
    this.googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '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';
  }

  /**
   * ✅ NOUVEAU : Rafraîchir le token Gmail si expiré
   * @param {string} refreshToken 
   * @param {string} userId 
   * @returns {Promise<string>} Nouveau access token
   */
  async refreshAccessToken(refreshToken, userId) {
    try {
      console.log(`[Drive:${userId}] 🔄 Rafraîchissement token...`);

      const response = await axios.post(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          refresh_token: refreshToken,
          client_id: this.googleClientId,
          client_secret: this.googleClientSecret,
          grant_type: 'refresh_token',
        }),
        { 
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000,
        }
      );

      const newAccessToken = response.data.access_token;
      console.log(`[Drive:${userId}] ✅ Token rafraîchi avec succès`);

      return newAccessToken;

    } catch (error) {
      console.error(`[Drive:${userId}] ❌ Erreur refresh token:`, error.response?.data || error.message);
      throw new Error('Impossible de rafraîchir le token Gmail');
    }
  }

  /**
   * ✅ MODIFIÉ : Sauvegarder avec retry + refresh token automatique
   */
  async saveJsonToAppData(accessToken, fileName, jsonData, userId = 'unknown', refreshToken = null) {
    const startTime = Date.now();
    
    try {
      console.log(`[Drive:${userId}] 📤 Sauvegarde ${fileName}...`);

      if (!accessToken) throw new Error('Access token manquant');
      if (!fileName || typeof fileName !== 'string') throw new Error('Nom de fichier invalide');
      if (!jsonData || typeof jsonData !== 'object') throw new Error('Données JSON invalides');

      const existingFile = await this._findFileInAppData(accessToken, fileName, userId, refreshToken);

      const boundary = '-------314159265358979323846';
      const delimiter = "\r\n--" + boundary + "\r\n";
      const close_delim = "\r\n--" + boundary + "--";

      const metadata = {
        name: fileName,
        mimeType: 'application/json',
        ...(!existingFile && { parents: ['appDataFolder'] })
      };

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

      // ✅ MODIFIÉ : Appel avec gestion 401
      let currentToken = accessToken;
      
      try {
        const response = await axios({
          method,
          url,
          data: multipartRequestBody,
          headers: {
            'Authorization': `Bearer ${currentToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`
          },
          timeout: 30000
        });

        const duration = Date.now() - startTime;
        console.log(`[Drive:${userId}] ✅ ${fileName} ${existingFile ? 'mis à jour' : 'créé'} en ${duration}ms`);

        this._invalidateUserCache(userId, fileName);
        return response.data.id;

      } catch (error) {
        // ✅ Si erreur 401 ET on a un refresh token, on réessaye
        if (error.response?.status === 401 && refreshToken) {
          console.log(`[Drive:${userId}] ⚠️ Token expiré, tentative refresh...`);
          
          const newToken = await this.refreshAccessToken(refreshToken, userId);
          
          // Réessayer avec le nouveau token
          const retryResponse = await axios({
            method,
            url,
            data: multipartRequestBody,
            headers: {
              'Authorization': `Bearer ${newToken}`,
              'Content-Type': `multipart/related; boundary=${boundary}`
            },
            timeout: 30000
          });

          const duration = Date.now() - startTime;
          console.log(`[Drive:${userId}] ✅ ${fileName} sauvegardé après refresh (${duration}ms)`);

          this._invalidateUserCache(userId, fileName);
          
          // ✅ IMPORTANT : Retourner le nouveau token pour mise à jour
          return { 
            fileId: retryResponse.data.id, 
            newAccessToken: newToken 
          };
        }

        throw error;
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[Drive:${userId}] ❌ Erreur sauvegarde ${fileName} (${duration}ms):`, this._formatError(error));
      throw new Error(`Impossible de sauvegarder ${fileName}: ${error.message}`);
    }
  }

  /**
   * ✅ MODIFIÉ : Lecture avec refresh token
   */
  async readJsonFromAppData(accessToken, fileName, userId = 'unknown', refreshToken = null) {
    const startTime = Date.now();
    
    try {
      const cacheKey = `${userId}:${fileName}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached) {
        console.log(`[Drive:${userId}] 📦 ${fileName} depuis cache`);
        return cached;
      }

      console.log(`[Drive:${userId}] 📥 Lecture ${fileName}...`);

      if (!accessToken) throw new Error('Access token manquant');

      const file = await this._findFileInAppData(accessToken, fileName, userId, refreshToken);

      if (!file) {
        console.log(`[Drive:${userId}] ℹ️ ${fileName} non trouvé (première utilisation)`);
        return null;
      }

      let currentToken = accessToken;

      try {
        const response = await axios.get(
          `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
          {
            headers: { 'Authorization': `Bearer ${currentToken}` },
            timeout: 30000
          }
        );

        const duration = Date.now() - startTime;
        console.log(`[Drive:${userId}] ✅ ${fileName} lu en ${duration}ms`);

        this.cache.set(cacheKey, response.data);
        return response.data;

      } catch (error) {
        if (error.response?.status === 401 && refreshToken) {
          console.log(`[Drive:${userId}] ⚠️ Token expiré, refresh et retry...`);
          
          const newToken = await this.refreshAccessToken(refreshToken, userId);
          
          const retryResponse = await axios.get(
            `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
            {
              headers: { 'Authorization': `Bearer ${newToken}` },
              timeout: 30000
            }
          );

          const duration = Date.now() - startTime;
          console.log(`[Drive:${userId}] ✅ ${fileName} lu après refresh (${duration}ms)`);

          this.cache.set(cacheKey, retryResponse.data);
          return retryResponse.data;
        }

        throw error;
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (error.response?.status === 404) {
        console.log(`[Drive:${userId}] ℹ️ ${fileName} introuvable (${duration}ms)`);
        return null;
      }

      console.error(`[Drive:${userId}] ❌ Erreur lecture ${fileName} (${duration}ms):`, this._formatError(error));
      return null;
    }
  }

  /**
   * ✅ MODIFIÉ : Ajouter refreshToken aux méthodes publiques
   */
  async loadBusinessInfo(accessToken, userId, refreshToken = null) {
    const data = await this.readJsonFromAppData(accessToken, 'business.json', userId, refreshToken);
    return data || { updatedAt: new Date().toISOString(), _empty: true };
  }

  async saveBusinessInfo(accessToken, info, userId, refreshToken = null) {
    if (info && typeof info !== 'object') throw new Error('Format business_info invalide');

    const data = {
      ...info,
      updatedAt: new Date().toISOString(),
      _version: '1.0'
    };

    delete data._empty;
    return await this.saveJsonToAppData(accessToken, 'business.json', data, userId, refreshToken);
  }

  async loadPlanningInfo(accessToken, userId, refreshToken = null) {
    const data = await this.readJsonFromAppData(accessToken, 'planning.json', userId, refreshToken);
    return data || { updatedAt: new Date().toISOString(), _empty: true };
  }

  async savePlanningInfo(accessToken, info, userId, refreshToken = null) {
    if (info && typeof info !== 'object') throw new Error('Format planning_info invalide');

    const data = {
      ...info,
      updatedAt: new Date().toISOString(),
      _version: '1.0'
    };

    delete data._empty;
    return await this.saveJsonToAppData(accessToken, 'planning.json', data, userId, refreshToken);
  }

  async checkDriveFiles(accessToken, userId = 'unknown', refreshToken = null) {
    try {
      console.log(`[Drive:${userId}] 🔍 Vérification fichiers...`);

      const [businessFile, planningFile] = await Promise.all([
        this._findFileInAppData(accessToken, 'business.json', userId, refreshToken).catch(() => null),
        this._findFileInAppData(accessToken, 'planning.json', userId, refreshToken).catch(() => null)
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

  async loadAllUserData(accessToken, userId, refreshToken = null) {
    const startTime = Date.now();
    
    try {
      console.log(`[Drive:${userId}] 📥 Chargement complet...`);

      const [businessInfo, planningInfo] = await Promise.all([
        this.loadBusinessInfo(accessToken, userId, refreshToken),
        this.loadPlanningInfo(accessToken, userId, refreshToken)
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
   * ✅ MODIFIÉ : _findFileInAppData avec refresh
   */
  async _findFileInAppData(accessToken, fileName, userId, refreshToken = null) {
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
      if (error.response?.status === 401 && refreshToken) {
        const newToken = await this.refreshAccessToken(refreshToken, userId);
        
        const retryResponse = await axios.get(
          'https://www.googleapis.com/drive/v3/files',
          {
            headers: { 'Authorization': `Bearer ${newToken}` },
            params: {
              q: `name='${fileName}' and 'appDataFolder' in parents and trashed=false`,
              spaces: 'appDataFolder',
              fields: 'files(id, name, createdTime, modifiedTime, size)',
              pageSize: 1
            },
            timeout: 15000
          }
        );

        return retryResponse.data.files.length > 0 ? retryResponse.data.files[0] : null;
      }

      if (error.response?.status === 404) return null;
      throw error;
    }
  }

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

  _invalidateUserCache(userId, fileName = null) {
    if (fileName) {
      const cacheKey = `${userId}:${fileName}`;
      this.cache.del(cacheKey);
      console.log(`[Drive:${userId}] 🗑️ Cache invalidé: ${fileName}`);
    } else {
      const keys = this.cache.keys();
      const userKeys = keys.filter(key => key.startsWith(`${userId}:`));
      this.cache.del(userKeys);
      console.log(`[Drive:${userId}] 🗑️ Cache complet invalidé (${userKeys.length} entrées)`);
    }
  }

  _formatError(error) {
    if (error.response) {
      return {
        status: error.response.status,
        data: error.response.data,
        message: error.message
      };
    }
    return { message: error.message, code: error.code };
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getCacheStats() {
    return {
      keys: this.cache.keys().length,
      hits: this.cache.getStats().hits,
      misses: this.cache.getStats().misses,
      size: this.cache.getStats().ksize
    };
  }
}

module.exports = new GoogleDriveService();
