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

    // Construire le deep link
    const params = new URLSearchParams({
      access_token,
      refresh_token: refresh_token || '',
      email,
      id_token: id_token || '',
      success: 'true',
    });

    const deepLink = `k2sdiag://auth?${params.toString()}`;
    console.log('🔗 [OAuth] Deep link créé');

    // ✅ HTML avec TRIPLE redirection (JavaScript + Meta + HTTP)
    res.send(generateHtmlRedirect(deepLink, '✓ Connexion réussie', email));

  } catch (error) {
    console.error('❌ [OAuth] Erreur:', error.message);
    const deepLink = `k2sdiag://auth?error=server_error&error_description=${encodeURIComponent(error.message)}`;
    res.send(generateHtmlRedirect(deepLink, '❌ Erreur serveur', error.message));
  }
});

// ✅ Fonction pour générer HTML avec triple redirection
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
      
      <!-- ✅ MÉTHODE 1 : Meta refresh (le plus fiable sur mobile) -->
      <meta http-equiv="refresh" content="0; url=${deepLink}">
      
      <title>${title}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          background: linear-gradient(135deg, ${bgColor} 0%, ${adjustColor(bgColor)} 100%);
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
          word-break: break-all;
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
        <div class="close-info">
          Si rien ne se passe, fermez cette fenêtre manuellement
        </div>
      </div>
      
      <script>
        console.log('✅ Page chargée');
        console.log('🔗 Deep link:', '${deepLink}'.substring(0, 50) + '...');
        
        // ✅ MÉTHODE 2 : JavaScript immédiat
        function redirect() {
          try {
            console.log('📱 Redirection JavaScript...');
            window.location.href = '${deepLink}';
          } catch (e) {
            console.error('❌ Erreur:', e);
          }
        }
        
        // Redirection immédiate
        redirect();
        
        // ✅ MÉTHODE 3 : Retry après 100ms
        setTimeout(redirect, 100);
        
        // ✅ MÉTHODE 4 : Retry après 500ms
        setTimeout(redirect, 3000);
        
        // Détecter si l'app s'ouvre
        let appOpened = false;
        
        window.addEventListener('blur', () => {
          console.log('✅ Fenêtre a perdu le focus (app probablement ouverte)');
          appOpened = true;
          setTimeout(() => {
            try { window.close(); } catch(e) {}
          }, 1000);
        });
        
        document.addEventListener('visibilitychange', () => {
          if (document.hidden && !appOpened) {
            console.log('✅ Page cachée');
            appOpened = true;
          }
        });
        
        // ✅ Forcer la fermeture après 5 secondes
        setTimeout(() => {
          console.log('🚪 Fermeture forcée');
          try { 
            window.close(); 
          } catch(e) {
            console.log('⚠️ Impossible de fermer');
          }
        }, 5000);
        
        // ✅ MÉTHODE 5 : Créer un lien cliquable (fallback ultime)
        setTimeout(() => {
          if (!appOpened) {
            const link = document.createElement('a');
            link.href = '${deepLink}';
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            console.log('🔗 Lien cliqué programmatiquement');
          }
        }, 1000);
      </script>
    </body>
    </html>
  `;
}

// Fonction utilitaire pour ajuster la couleur
function adjustColor(color) {
  return color.replace('#', '#') + '88'; // Ajoute transparence
}

module.exports = router;
