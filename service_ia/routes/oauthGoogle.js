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
    console.log('📋 Code:', code?.substring(0, 20));

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

    const { access_token, refresh_token, id_token } = tokenResponse.data;
    console.log('✅ [OAuth] Tokens reçus');

    // Récupérer l'email
    const userInfoResponse = await axios.get(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    const email = userInfoResponse.data.email;
    console.log('✅ [OAuth] Email:', email);

    // 🔹 IMPORTANT : Construction manuelle avec encodage proper
    const params = new URLSearchParams({
      access_token,
      email,
      success: 'true'
    });

    if (refresh_token) params.append('refresh_token', refresh_token);
    if (id_token) params.append('id_token', id_token);

    const deepLink = `k2sdiag://auth?${params.toString()}`;
    
    console.log('🔗 [OAuth] Deep link longueur:', deepLink.length);
    console.log('📋 Deep link:', deepLink.substring(0, 100) + '...');

    // HTML optimisé pour Android avec multiples méthodes de redirection
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
        let redirected = false;
        
        function log(msg) {
          console.log(msg);
          const debugEl = document.getElementById('debug');
          debugEl.innerHTML += msg + '<br>';
          debugEl.scrollTop = debugEl.scrollHeight;
        }
        
        log('🔗 Deep link: ' + deepLink.substring(0, 50) + '...');
        log('📏 Longueur: ' + deepLink.length + ' caractères');
        
        function redirect() {
          if (redirected) {
            log('⚠️ Redirection déjà effectuée');
            return;
          }
          redirected = true;
          log('🔄 Redirection unique...');
          
          try {
            // UNE SEULE tentative avec window.location
            window.location.href = deepLink;
            log('✅ Redirection lancée');
          } catch (e) {
            log('❌ Erreur: ' + e.message);
          }
        }
        
        // Démarrer UNE SEULE FOIS immédiatement
        redirect();
        
        // Afficher bouton manuel après 2 secondes si pas ouvert
        setTimeout(() => {
          if (!opened) {
            const btn = document.getElementById('manualBtn');
            btn.style.display = 'inline-block';
            btn.onclick = (e) => {
              e.preventDefault();
              log('👆 Clic manuel');
              window.location.href = deepLink;
            };
            document.getElementById('status').style.display = 'none';
            log('🔘 Bouton manuel affiché');
          }
        }, 2000);
        
        // Détecter ouverture app
        function detectAppOpened() {
          if (opened) return;
          opened = true;
          log('✅ Application ouverte !');
          document.getElementById('status').innerHTML = '✅ Retour à l\'application...';
          setTimeout(() => {
            try { window.close(); } catch(e) {
              document.getElementById('status').innerHTML = '✅ Vous pouvez fermer cette page';
            }
          }, 1500);
        }
        
        window.addEventListener('blur', detectAppOpened);
        window.addEventListener('pagehide', detectAppOpened);
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) detectAppOpened();
        });
      </script>
    </body>
    </html>
  `;
}

module.exports = router;
