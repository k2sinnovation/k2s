const express = require('express');
const router = express.Router();
const axios = require('axios');

const GOOGLE_CLIENT_ID = '461385830578-pbnq271ga15ggms5c4uckspo4480litm.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const REDIRECT_URI = 'https://k2s.onrender.com/oauth/google/callback';

router.get('/oauth/google/callback', async (req, res) => {
  try {
    const { code, error, error_description } = req.query;

    console.log('📨 [OAuth] Callback reçu');
    console.log('📋 Paramètres:', { code: code?.substring(0, 20), error });

    if (error) {
      const deepLink = `k2sdiag://auth?error=${encodeURIComponent(error)}`;
      return res.send(generateHtmlRedirect(deepLink, '❌ Erreur OAuth', error));
    }

    if (!code) {
      const deepLink = 'k2sdiag://auth?error=no_code';
      return res.send(generateHtmlRedirect(deepLink, '❌ Code manquant', 'Aucun code reçu'));
    }

    console.log('🔄 [OAuth] Échange du code...');

    // Échanger le code
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

    const { access_token, refresh_token, id_token } = tokenResponse.data;
    console.log('✅ [OAuth] Tokens reçus');

    // Récupérer l'email
    const userInfoResponse = await axios.get(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    const email = userInfoResponse.data.email;
    console.log('✅ [OAuth] Email:', email);

    // 🔹 FIX : Construction manuelle du deep link (évite les problèmes d'encodage)
    const deepLinkParams = [
      `access_token=${encodeURIComponent(access_token)}`,
      `email=${encodeURIComponent(email)}`,
      refresh_token ? `refresh_token=${encodeURIComponent(refresh_token)}` : null,
      id_token ? `id_token=${encodeURIComponent(id_token)}` : null,
      'success=true'
    ].filter(Boolean).join('&');

    const deepLink = `k2sdiag://auth?${deepLinkParams}`;
    console.log('🔗 [OAuth] Deep link créé (longueur:', deepLink.length, ')');

    // HTML avec redirection optimisée pour Android
    res.send(generateHtmlRedirect(deepLink, '✓ Connexion réussie', email));

  } catch (error) {
    console.error('❌ [OAuth] Erreur:', error.message);
    if (error.response) {
      console.error('📄 Réponse erreur:', error.response.data);
    }
    const deepLink = `k2sdiag://auth?error=server_error&error_description=${encodeURIComponent(error.message)}`;
    res.send(generateHtmlRedirect(deepLink, '❌ Erreur serveur', error.message));
  }
});

function generateHtmlRedirect(deepLink, title, message) {
  const isSuccess = title.includes('✓');
  const bgColor = isSuccess ? '#667eea' : '#ff6b6b';
  const icon = isSuccess ? '✓' : '❌';
  
  // 🔹 FIX : Échapper correctement le deep link pour JavaScript
  const escapedDeepLink = deepLink.replace(/'/g, "\\'");

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
        .info {
          margin-top: 20px;
          font-size: 14px;
          opacity: 0.8;
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
        .close-info {
          margin-top: 30px;
          font-size: 12px;
          opacity: 0.7;
        }
        .manual-link {
          margin-top: 20px;
          padding: 12px 24px;
          background: rgba(255,255,255,0.2);
          border: 2px solid white;
          border-radius: 8px;
          color: white;
          text-decoration: none;
          display: inline-block;
          font-weight: 600;
          transition: all 0.3s;
        }
        .manual-link:hover {
          background: rgba(255,255,255,0.3);
          transform: scale(1.05);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">${icon}</div>
        <h1>${title}</h1>
        ${message ? `<div class="message">${message}</div>` : ''}
        <div class="info">
          Redirection vers l'application...
          <div class="spinner"></div>
        </div>
        
        <!-- 🔹 Lien manuel de secours -->
        <a href="${deepLink}" class="manual-link" id="manualLink" style="display:none;">
          Ouvrir l'application
        </a>
        
        <div class="close-info">
          Si rien ne se passe, fermez cette fenêtre
        </div>
      </div>
      
      <script>
        const deepLink = '${escapedDeepLink}';
        let redirectAttempts = 0;
        let appOpened = false;
        
        console.log('✅ Page chargée');
        console.log('🔗 Deep link:', deepLink.substring(0, 50) + '...');
        
        function tryRedirect() {
          if (appOpened) return;
          
          redirectAttempts++;
          console.log('📱 Tentative de redirection #' + redirectAttempts);
          
          try {
            // Méthode 1 : window.location
            window.location.href = deepLink;
            
            // Méthode 2 : window.location.replace
            setTimeout(() => {
              if (!appOpened) window.location.replace(deepLink);
            }, 500);
            
          } catch (e) {
            console.error('❌ Erreur redirection:', e);
          }
        }
        
        // Redirection immédiate
        tryRedirect();
        
        // Retry après 1 seconde
        setTimeout(tryRedirect, 1000);
        
        // Afficher le lien manuel après 2 secondes
        setTimeout(() => {
          if (!appOpened) {
            document.getElementById('manualLink').style.display = 'inline-block';
            console.log('🔗 Lien manuel affiché');
          }
        }, 2000);
        
        // Détecter si l'app s'est ouverte
        window.addEventListener('blur', () => {
          console.log('✅ Focus perdu → App ouverte');
          appOpened = true;
        });
        
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) {
            console.log('✅ Page cachée → App ouverte');
            appOpened = true;
          }
        });
        
        // Fermeture auto après 8 secondes
        setTimeout(() => {
          if (appOpened) {
            console.log('🚪 Fermeture (succès)');
            try { window.close(); } catch(e) {}
          }
        }, 8000);
      </script>
    </body>
    </html>
  `;
}

module.exports = router;
