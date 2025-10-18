const express = require('express');
const router = express.Router();
const axios = require('axios');
const User = require('../models/User');
const Session = require('../models/Session');

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

    const userInfoResponse = await axios.get(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    const email = userInfoResponse.data.email;
    console.log('✅ [OAuth] Email:', email);

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
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
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

    const deviceId = req.query.state || `web_${Date.now()}`;
    const sessionToken = Session.generateToken();
    const hashedToken = Session.hashToken(sessionToken);

    await Session.updateMany(
      { userId: user._id, deviceId: deviceId },
      { isActive: false }
    );

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

    console.log(`✅ [OAuth] Session créée (ID: ${newSession._id})`);

    const params = new URLSearchParams({
      access_token,
      email,
      success: 'true',
      session_token: sessionToken,
      user_id: user._id.toString(),
      expires_in: (expires_in || 3600).toString(),
    });

    if (refresh_token) params.append('refresh_token', refresh_token);
    if (id_token) params.append('id_token', id_token);

    const deepLink = `k2sdiag://auth?${params.toString()}`;
    
    console.log('🔗 [OAuth] Deep link créé');

    res.send(generateHtmlRedirect(deepLink, '✓ Connexion réussie', email));

  } catch (error) {
    console.error('❌ [OAuth] Erreur:', error.message);
    const deepLink = `k2sdiag://auth?error=server_error&error_description=${encodeURIComponent(error.message)}`;
    res.send(generateHtmlRedirect(deepLink, '❌ Erreur serveur', error.message));
  }
});

// ✅ CODE ORIGINAL MAIS AVEC 1 SEULE REDIRECTION
function generateHtmlRedirect(deepLink, title, message) {
  const isSuccess = title.includes('✓');
  const bgColor = isSuccess ? '#667eea' : '#ff6b6b';
  const icon = isSuccess ? '✓' : '❌';

  return `
    <!DOCTYPE html>
    <html lang="fr">
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
        h1 { 
          margin: 20px 0; 
          font-size: 28px;
          font-weight: 600;
        }
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
        #status.hidden { display: none; }
        .closing-message {
          margin-top: 15px;
          font-size: 14px;
          opacity: 0.9;
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
        
        <div class="debug" id="debug" style="margin-top:20px; padding:10px; background:rgba(0,0,0,0.3); border-radius:5px; font-size:11px; font-family:monospace; max-height:100px; overflow:auto; word-break:break-all;"></div>
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
        
        // ✅ UNE SEULE REDIRECTION (au lieu de 4)
        function redirect() {
          if (opened) {
            log('⚠️ Déjà redirigé, abandon');
            return;
          }
          opened = true;
          
          log('🔄 Redirection unique...');
          
          // Méthode principale: window.location
          window.location.href = deepLink;
        }
        
        // ✅ DÉMARRER LA REDIRECTION (1 SEULE FOIS)
        redirect();
        
        // ✅ Bouton manuel après 2s
        setTimeout(() => {
          const btn = document.getElementById('manualBtn');
          btn.style.display = 'inline-block';
          btn.onclick = (e) => {
            e.preventDefault();
            log('👆 Clic manuel');
            window.location.href = deepLink;
          };
          document.getElementById('status').classList.add('hidden');
          log('🔘 Bouton manuel affiché');
        }, 2000);
        
        // Événements de détection d'ouverture
        window.addEventListener('blur', () => { 
          log('📱 App ouverte (blur)');
          opened = true; 
        });
        
        window.addEventListener('pagehide', () => { 
          log('📱 App ouverte (pagehide)');
          opened = true; 
        });
        
        // ✅ Fermeture auto après 10s (succès uniquement)
        ${isSuccess ? `
        setTimeout(() => {
          if (opened) {
            log('⏱️ 10s - tentative fermeture');
            try { 
              window.close(); 
            } catch(e) {
              document.body.innerHTML = \`
                <div style="text-align:center; padding:40px; color:white;">
                  <div style="font-size:60px; margin-bottom:20px;">✅</div>
                  <h1>Authentification réussie</h1>
                  <p style="margin-top:20px; opacity:0.8;">Vous pouvez fermer cette page</p>
                </div>
              \`;
            }
          }
        }, 10000);
        ` : ''}
        
        log('📊 User Agent: ' + navigator.userAgent.substring(0, 30) + '...');
      </script>
    </body>
    </html>
  `;
}

module.exports = router;
