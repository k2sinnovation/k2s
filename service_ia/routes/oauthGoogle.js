const express = require('express');
const router = express.Router();
const axios = require('axios');
const User = require('../models/User');
const Session = require('../models/Session'); // ✅ IMPORTANT

const GOOGLE_CLIENT_ID = '461385830578-pbnq271ga15ggms5c4uckspo4480litm.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const REDIRECT_URI = 'https://k2s.onrender.com/oauth/google/callback';

router.get('/oauth/google/callback', async (req, res) => {
  try {
    const { code, error, error_description } = req.query;

    console.log('📨 [OAuth] Callback reçu');

    if (error) {
      console.log('❌ Erreur OAuth:', error);
      const deepLink = `k2sdiag://auth?error=${encodeURIComponent(error)}`;
      return res.send(generateHtmlRedirect(deepLink, '❌ Erreur OAuth', error));
    }

    if (!code) {
      console.log('❌ Code manquant');
      const deepLink = 'k2sdiag://auth?error=no_code';
      return res.send(generateHtmlRedirect(deepLink, '❌ Code manquant', 'Aucun code reçu'));
    }

    console.log('🔄 [OAuth] Échange du code...');

    // Échanger le code contre les tokens
    const tokenResponse = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
      { 
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      }
    );

    const { access_token, refresh_token, id_token, expires_in } = tokenResponse.data;
    console.log('✅ [OAuth] Tokens reçus');

    // Récupérer l'email
    const userInfoResponse = await axios.get(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    const email = userInfoResponse.data.email;
    console.log('✅ [OAuth] Email:', email);

    // ✅ CRÉER OU METTRE À JOUR L'UTILISATEUR
    let user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      console.log('🆕 [OAuth] Création nouvel utilisateur:', email);
      
      user = new User({
        email: email.toLowerCase(),
        password: Math.random().toString(36).slice(-12),
        businessName: email.split('@')[0] || 'Mon Entreprise',
        deviceId: `gmail_${Date.now()}`,
        emailConfig: {
          provider: 'gmail',
          accessToken: access_token,
          refreshToken: refresh_token || '',
          email: email,
          connectedAt: new Date()
        },
        subscription: {
          plan: 'free',
          isActive: true,
          startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 jours gratuits
        },
        aiSettings: {
          isEnabled: false,
          autoReplyEnabled: false,
          requireValidation: true,
          salonName: email.split('@')[0] || 'Mon Entreprise',
          ownerEmail: email,
          role: 'Assistant virtuel pour la gestion des rendez-vous',
          instructions: 'Sois professionnel et courtois.',
          tone: 'professionnel',
          aiModel: 'gpt-4',
          temperature: 0.7,
          maxTokens: 500
        }
      });

      await user.save();
      console.log('✅ [OAuth] Utilisateur créé:', user._id);
      
    } else {
      console.log('🔄 [OAuth] Utilisateur existant, mise à jour tokens');
      
      user.emailConfig.provider = 'gmail';
      user.emailConfig.accessToken = access_token;
      if (refresh_token) {
        user.emailConfig.refreshToken = refresh_token;
      }
      user.emailConfig.email = email;
      user.emailConfig.connectedAt = new Date();
      user.lastLoginAt = new Date();
      
      await user.save();
      console.log('✅ [OAuth] Tokens mis à jour');
    }

    // ✅ GÉNÉRER SESSION TOKEN PERMANENT (1 an)
    const deviceId = req.query.state || `web_${Date.now()}`;
    const sessionToken = Session.generateToken();
    const hashedToken = Session.hashToken(sessionToken);

    // ✅ Révoquer anciennes sessions du même device (optionnel)
    await Session.updateMany(
      { userId: user._id, deviceId: deviceId },
      { isActive: false }
    );

    // ✅ CRÉER NOUVELLE SESSION EN BASE
    const newSession = await Session.create({
      userId: user._id,
      deviceId: deviceId,
      sessionToken: hashedToken,
      emailProvider: 'gmail',
      emailAccessToken: access_token,
      emailRefreshToken: refresh_token || '',
      ipAddress: req.ip || req.connection.remoteAddress,
      deviceInfo: {
        platform: 'mobile',
        appVersion: '1.0.0'
      }
    });

    console.log(`✅ [OAuth] Session créée (ID: ${newSession._id}, expire: ${newSession.expiresAt})`);

    // ✅ Construction du deep link avec SESSION TOKEN
    const params = new URLSearchParams({
      access_token,
      email,
      success: 'true',
      session_token: sessionToken, // ✅ SESSION TOKEN non hashé
      user_id: user._id.toString(),
      expires_in: (expires_in || 3600).toString(),
    });

    if (refresh_token) params.append('refresh_token', refresh_token);
    if (id_token) params.append('id_token', id_token);

    const deepLink = `k2sdiag://auth?${params.toString()}`;
    
    console.log('🔗 [OAuth] Deep link créé (longueur:', deepLink.length, ')');
    console.log('🎯 [OAuth] Session Token:', sessionToken.substring(0, 20) + '...');

    res.send(generateHtmlRedirect(deepLink, '✓ Connexion réussie', email));

  } catch (error) {
    console.error('❌ [OAuth] Erreur:', error.message);
    if (error.response) {
      console.error('📄 Réponse:', error.response.data);
    }
    const deepLink = `k2sdiag://auth?error=server_error&error_description=${encodeURIComponent(error.message)}`;
    res.send(generateHtmlRedirect(deepLink, '❌ Erreur serveur', error.message));
  }
});

// ✅ ROUTE DE REFRESH TOKEN OAUTH (pour compatibilité)
router.post('/oauth/google/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({ error: 'refresh_token manquant' });
    }

    console.log('🔄 [OAuth] Refresh token Google...');

    const response = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        refresh_token: refresh_token,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        grant_type: 'refresh_token',
      }),
      { 
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      }
    );

    const { access_token, expires_in, id_token } = response.data;

    console.log('✅ [OAuth] Token Google rafraîchi');

    res.json({
      access_token,
      expires_in: expires_in || 3600,
      id_token: id_token || '',
    });

  } catch (error) {
    console.error('❌ [OAuth] Erreur refresh:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Erreur refresh token',
      details: error.message 
    });
  }
});

function generateHtmlRedirect(deepLink, title, message) {
  const isSuccess = title.includes('✓');
  const bgColor = isSuccess ? '#667eea' : '#ff6b6b';
  const icon = isSuccess ? '✓' : '❌';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          background: linear-gradient(135deg, ${bgColor} 0%, ${bgColor}cc 100%);
          color: white;
          padding: 20px;
        }
        .container {
          text-align: center;
          padding: 40px;
          background: rgba(255,255,255,0.1);
          border-radius: 20px;
          backdrop-filter: blur(10px);
          box-shadow: 0 8px 32px rgba(0,0,0,0.3);
          max-width: 400px;
          width: 100%;
        }
        .icon {
          font-size: 80px;
          margin-bottom: 20px;
          animation: scale 0.5s ease-in-out;
        }
        @keyframes scale {
          0% { transform: scale(0); }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }
        h1 { margin: 20px 0; font-size: 28px; font-weight: 600; }
        .message {
          background: rgba(255,255,255,0.2);
          padding: 15px 20px;
          border-radius: 10px;
          margin: 20px 0;
          font-size: 14px;
          word-break: break-word;
        }
        .spinner {
          display: inline-block;
          width: 20px;
          height: 20px;
          border: 3px solid rgba(255,255,255,0.3);
          border-radius: 50%;
          border-top-color: white;
          animation: spin 1s ease-in-out infinite;
          margin-top: 10px;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .manual-link {
          margin-top: 20px;
          padding: 15px 30px;
          background: white;
          color: ${bgColor};
          border: none;
          border-radius: 8px;
          font-weight: 600;
          font-size: 16px;
          cursor: pointer;
          text-decoration: none;
          display: inline-block;
          box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        }
        .debug {
          margin-top: 20px;
          padding: 10px;
          background: rgba(0,0,0,0.3);
          border-radius: 5px;
          font-size: 11px;
          font-family: monospace;
          max-height: 100px;
          overflow: auto;
          word-break: break-all;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">${icon}</div>
        <h1>${title}</h1>
        ${message ? `<div class="message">${message}</div>` : ''}
        
        <div id="status">
          Redirection automatique...
          <div class="spinner"></div>
        </div>
        
        <a href="#" class="manual-link" id="manualBtn" style="display:none;">
          📱 Ouvrir l'application
        </a>
        
        <div class="debug" id="debug"></div>
      </div>
      
      <script>
        const deepLink = ${JSON.stringify(deepLink)};
        let opened = false;
        
        function log(msg) {
          console.log(msg);
          const debugEl = document.getElementById('debug');
          debugEl.innerHTML += msg + '<br>';
          debugEl.scrollTop = debugEl.scrollHeight;
        }
        
        log('🔗 Link: ' + deepLink.substring(0, 50) + '...');
        
        function redirect() {
          if (opened) return;
          log('🔄 Redirection...');
          
          const iframe = document.createElement('iframe');
          iframe.style.display = 'none';
          iframe.src = deepLink;
          document.body.appendChild(iframe);
          
          setTimeout(() => {
            document.body.removeChild(iframe);
            window.location.href = deepLink;
          }, 500);
        }
        
        redirect();
        setTimeout(redirect, 1000);
        
        setTimeout(() => {
          if (!opened) {
            const btn = document.getElementById('manualBtn');
            btn.style.display = 'inline-block';
            btn.onclick = (e) => {
              e.preventDefault();
              window.location.href = deepLink;
            };
            document.getElementById('status').style.display = 'none';
          }
        }, 2000);
        
        window.addEventListener('blur', () => { opened = true; });
        window.addEventListener('pagehide', () => { opened = true; });
      </script>
    </body>
    </html>
  `;
}

module.exports = router;
