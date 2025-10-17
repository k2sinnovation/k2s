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

    // Construction du deep link
    const params = new URLSearchParams({
      access_token,
      email,
      success: 'true'
    });

    if (refresh_token) params.append('refresh_token', refresh_token);
    if (id_token) params.append('id_token', id_token);

    const deepLink = `k2sdiag://auth?${params.toString()}`;
    
    console.log('🔗 [OAuth] Deep link créé');

    // HTML optimisé avec fermeture automatique
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
          display: none;
          box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        }
        #status.hidden { display: none; }
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
        
        <a href="#" class="manual-link" id="manualBtn">
          📱 Ouvrir l'application
        </a>
      </div>
      
      <script>
        const deepLink = ${JSON.stringify(deepLink)};
        let redirected = false;
        
        function redirect() {
          if (redirected) return;
          redirected = true;
          
          console.log('🔗 Redirection vers:', deepLink.substring(0, 50) + '...');
          
          // 🔹 Méthode 1: Location immédiate
          window.location.href = deepLink;
          
          // 🔹 Méthode 2: Iframe backup après 300ms
          setTimeout(() => {
            try {
              const iframe = document.createElement('iframe');
              iframe.style.display = 'none';
              iframe.src = deepLink;
              document.body.appendChild(iframe);
              
              setTimeout(() => {
                try { document.body.removeChild(iframe); } catch(e) {}
              }, 1000);
            } catch(e) {
              console.error('Erreur iframe:', e);
            }
          }, 300);
        }
        
        // 🔹 Démarrer immédiatement
        redirect();
        
        // 🔹 Détecter ouverture app
        let appOpened = false;
        function onAppOpen() {
          if (appOpened) return;
          appOpened = true;
          console.log('✅ App ouverte, fermeture page...');
          
          document.getElementById('status').innerHTML = '✅ Retour à l\'application...';
          
          // 🔹 Fermer automatiquement après 1.5s
          setTimeout(() => {
            try {
              window.close();
            } catch(e) {
              // Si échec, afficher message
              document.getElementById('status').innerHTML = 
                '✅ Vous pouvez fermer cette page';
            }
          }, 1500);
        }
        
        // 🔹 Événements de détection
        window.addEventListener('blur', onAppOpen);
        window.addEventListener('pagehide', onAppOpen);
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) onAppOpen();
        });
        
        // 🔹 Afficher bouton manuel après 3s si pas d'ouverture
        setTimeout(() => {
          if (!appOpened) {
            const btn = document.getElementById('manualBtn');
            btn.style.display = 'inline-block';
            btn.onclick = (e) => {
              e.preventDefault();
              redirect();
            };
            document.getElementById('status').classList.add('hidden');
          }
        }, 3000);
        
        // 🔹 Fermeture forcée après 10s en cas de succès
        ${isSuccess ? `
        setTimeout(() => {
          if (appOpened) {
            try { window.close(); } catch(e) {
              document.body.innerHTML = '<div class="container"><h1>✅ Authentification réussie</h1><p>Vous pouvez fermer cette page</p></div>';
            }
          }
        }, 10000);
        ` : ''}
      </script>
    </body>
    </html>
  `;
}

module.exports = router;
