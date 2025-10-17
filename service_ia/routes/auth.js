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
    
    console.log('🔗 [OAuth] Deep link créé (longueur: ' + deepLink.length + ')');

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
          display: none;
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
        
        <a href="#" class="manual-link" id="manualBtn">
          📱 Ouvrir l'application
        </a>
      </div>
      
      <script>
        const deepLink = ${JSON.stringify(deepLink)};
        let redirected = false;
        let appOpened = false;
        
        console.log('🔗 Deep link longueur:', deepLink.length);
        
        // 🔹 Fonction de redirection unique
        function redirect() {
          if (redirected) {
            console.log('⚠️ Redirection déjà effectuée');
            return;
          }
          redirected = true;
          
          console.log('🚀 Démarrage redirection...');
          
          // Méthode 1: window.location (principale)
          try {
            window.location.href = deepLink;
            console.log('✓ window.location.href exécuté');
          } catch (e) {
            console.error('❌ Erreur window.location:', e);
          }
          
          // Méthode 2: Iframe (backup Android)
          setTimeout(() => {
            if (!appOpened) {
              console.log('🔄 Tentative iframe backup...');
              try {
                const iframe = document.createElement('iframe');
                iframe.style.display = 'none';
                iframe.src = deepLink;
                document.body.appendChild(iframe);
                
                setTimeout(() => {
                  try { 
                    document.body.removeChild(iframe); 
                    console.log('🗑️ Iframe nettoyé');
                  } catch(e) {}
                }, 1000);
              } catch(e) {
                console.error('❌ Erreur iframe:', e);
              }
            }
          }, 500);
        }
        
        // 🔹 Détection d'ouverture app
        function onAppOpen() {
          if (appOpened) return;
          appOpened = true;
          
          console.log('✅ Application détectée comme ouverte');
          
          const statusEl = document.getElementById('status');
          statusEl.innerHTML = '✅ Retour à l\'application...<div class="closing-message">Cette page va se fermer</div>';
          
          // Tentative de fermeture progressive
          let closeAttempts = 0;
          const tryClose = () => {
            closeAttempts++;
            console.log('🚪 Tentative fermeture #' + closeAttempts);
            
            try {
              window.close();
              console.log('✓ window.close() appelé');
            } catch(e) {
              console.log('⚠️ window.close() impossible:', e.message);
            }
            
            // Si on ne peut pas fermer après 3 tentatives, afficher message
            if (closeAttempts >= 3) {
              statusEl.innerHTML = '✅ Authentification réussie<div class="closing-message">Vous pouvez fermer cette page</div>';
            } else if (closeAttempts < 3) {
              setTimeout(tryClose, 1000);
            }
          };
          
          setTimeout(tryClose, 1500);
        }
        
        // 🔹 Événements de détection d'ouverture app
        window.addEventListener('blur', () => {
          console.log('📱 Événement: blur');
          onAppOpen();
        });
        
        window.addEventListener('pagehide', () => {
          console.log('📱 Événement: pagehide');
          onAppOpen();
        });
        
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) {
            console.log('📱 Événement: visibilitychange (hidden)');
            onAppOpen();
          }
        });
        
        // Pour Android uniquement
        if (/Android/i.test(navigator.userAgent)) {
          console.log('📱 Détecté: Android');
          window.addEventListener('focus', () => {
            // Si on revient au focus sans avoir ouvert l'app, c'est que ça a échoué
            setTimeout(() => {
              if (!appOpened) {
                console.log('⚠️ Retour focus sans ouverture app');
              }
            }, 300);
          });
        }
        
        // 🔹 Démarrer la redirection immédiatement
        redirect();
        
        // 🔹 Bouton manuel après 3s
        setTimeout(() => {
          if (!appOpened) {
            console.log('🔘 Affichage bouton manuel');
            const btn = document.getElementById('manualBtn');
            const statusEl = document.getElementById('status');
            
            btn.style.display = 'inline-block';
            btn.onclick = (e) => {
              e.preventDefault();
              console.log('👆 Clic manuel sur bouton');
              redirect();
            };
            
            statusEl.classList.add('hidden');
          }
        }, 3000);
        
        // 🔹 Fermeture forcée après 10s (succès uniquement)
        ${isSuccess ? `
        setTimeout(() => {
          console.log('⏱️ Timeout 10s atteint');
          if (appOpened) {
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
          } else {
            console.log('⚠️ App non ouverte après 10s');
          }
        }, 10000);
        ` : ''}
        
        // 🔹 Log de debug
        console.log('📊 User Agent:', navigator.userAgent);
        console.log('🌐 Navigateur:', navigator.appVersion);
      </script>
    </body>
    </html>
  `;
}

module.exports = router;
