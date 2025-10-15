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
    console.log('Code:', code ? 'présent' : 'absent');
    console.log('Error:', error || 'aucune');

    // Gérer les erreurs OAuth
    if (error) {
      console.error('❌ [OAuth] Erreur:', error, error_description);
      
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Erreur OAuth</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%);
              color: white;
            }
            .container {
              text-align: center;
              padding: 40px;
              background: rgba(255,255,255,0.1);
              border-radius: 20px;
              backdrop-filter: blur(10px);
              max-width: 400px;
            }
            h1 { margin: 20px 0; font-size: 24px; }
            p { opacity: 0.9; margin: 10px 0; }
            .error-code { 
              font-family: monospace; 
              font-size: 12px; 
              opacity: 0.7; 
              margin-top: 20px; 
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div style="font-size: 64px; margin-bottom: 20px;">❌</div>
            <h1>Erreur OAuth</h1>
            <p>${error}</p>
            ${error_description ? `<p>${error_description}</p>` : ''}
            <p style="font-size: 14px; margin-top: 30px;">Retour vers l'application...</p>
            <div class="error-code">Code: ${error}</div>
          </div>
          <script>
            // ✅ Redirection JavaScript (fonctionne sur mobile)
            const deepLink = 'k2sdiag://auth?error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(error_description || '')}';
            
            console.log('Redirection vers:', deepLink);
            window.location.href = deepLink;
            
            // Fallback : fermer après 3 secondes
            setTimeout(() => {
              try {
                window.close();
              } catch (e) {
                console.log('Impossible de fermer automatiquement');
              }
            }, 3000);
          </script>
        </body>
        </html>
      `);
    }

    if (!code) {
      console.error('❌ [OAuth] Code manquant');
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><style>
          body { font-family: Arial; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #ff6b6b; color: white; }
          .container { text-align: center; padding: 40px; }
        </style></head>
        <body>
          <div class="container">
            <h1>❌ Code OAuth manquant</h1>
            <p>Retour vers l'application...</p>
          </div>
          <script>
            window.location.href = 'k2sdiag://auth?error=no_code';
            setTimeout(() => window.close(), 2000);
          </script>
        </body>
        </html>
      `);
    }

    console.log('🔄 [OAuth] Échange du code...');

    // Échanger le code contre des tokens
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
    console.log('  - access_token:', !!access_token);
    console.log('  - refresh_token:', !!refresh_token);

    // Récupérer l'email
    const userInfoResponse = await axios.get(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { 
        headers: { Authorization: `Bearer ${access_token}` },
        timeout: 5000,
      }
    );

    const email = userInfoResponse.data.email;
    console.log('✅ [OAuth] Email:', email);

    // ✅ Construire le deep link
    const params = new URLSearchParams({
      access_token,
      refresh_token: refresh_token || '',
      email,
      id_token: id_token || '',
      success: 'true',
    });

    const deepLink = `k2sdiag://auth?${params.toString()}`;

    console.log('🔗 [OAuth] Deep link créé (tronqué):', `k2sdiag://auth?access_token=...&email=${email}`);

    // ✅ HTML avec redirection JavaScript (SOLUTION)
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Connexion réussie</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }
          .container {
            text-align: center;
            padding: 40px;
            background: rgba(255,255,255,0.1);
            border-radius: 20px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            max-width: 400px;
          }
          .checkmark {
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
          p { 
            opacity: 0.9; 
            margin: 10px 0;
            font-size: 16px;
          }
          .email {
            background: rgba(255,255,255,0.2);
            padding: 10px 20px;
            border-radius: 10px;
            margin: 20px 0;
            font-size: 14px;
            word-break: break-all;
          }
          .loading {
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
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="checkmark">✓</div>
          <h1>Connexion réussie !</h1>
          <div class="email">${email}</div>
          <p>Retour vers l'application...</p>
          <div class="loading">
            <div class="spinner"></div>
          </div>
          <p style="font-size: 12px; margin-top: 30px; opacity: 0.7;">
            Si la fenêtre ne se ferme pas, vous pouvez la fermer manuellement
          </p>
        </div>
        
        <script>
          console.log('✅ Page chargée');
          
          // ✅ Deep link (URL complète pour debug)
          const deepLink = '${deepLink}';
          console.log('🔗 Deep link:', deepLink.substring(0, 100) + '...');
          
          // ✅ Redirection IMMÉDIATE vers l'app
          function redirectToApp() {
            try {
              console.log('📱 Tentative de redirection...');
              window.location.href = deepLink;
              console.log('✅ Redirection déclenchée');
            } catch (e) {
              console.error('❌ Erreur redirection:', e);
            }
          }
          
          // Redirection immédiate
          redirectToApp();
          
          // ✅ Retry après 500ms (au cas où)
          setTimeout(() => {
            console.log('🔄 Retry redirection');
            redirectToApp();
          }, 500);
          
          // ✅ Fermer la fenêtre après 3 secondes
          setTimeout(() => {
            console.log('🚪 Tentative fermeture fenêtre');
            try {
              window.close();
            } catch (e) {
              console.log('⚠️ Impossible de fermer automatiquement');
            }
          }, 3000);
          
          // ✅ Détecter si l'app s'est ouverte (blur = fenêtre perd le focus)
          window.addEventListener('blur', () => {
            console.log('✅ App probablement ouverte (blur event)');
            setTimeout(() => {
              try {
                window.close();
              } catch (e) {}
            }, 1000);
          });
          
          // ✅ Log visibilité
          document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
              console.log('✅ Page cachée, app probablement ouverte');
            }
          });
        </script>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('❌ [OAuth] Erreur serveur:', error.message);
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: Arial;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%);
            color: white;
          }
          .container {
            text-align: center;
            padding: 40px;
            background: rgba(255,255,255,0.1);
            border-radius: 20px;
            max-width: 400px;
          }
          .error-details {
            background: rgba(0,0,0,0.2);
            padding: 15px;
            border-radius: 10px;
            margin-top: 20px;
            font-size: 12px;
            font-family: monospace;
            text-align: left;
            word-break: break-word;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div style="font-size: 64px; margin-bottom: 20px;">❌</div>
          <h1>Erreur serveur</h1>
          <p>Une erreur est survenue lors de l'authentification</p>
          <div class="error-details">${error.message}</div>
          <p style="font-size: 14px; margin-top: 30px;">Retour vers l'application...</p>
        </div>
        <script>
          const deepLink = 'k2sdiag://auth?error=server_error&error_description=${encodeURIComponent(error.message)}';
          window.location.href = deepLink;
          setTimeout(() => window.close(), 4000);
        </script>
      </body>
      </html>
    `);
  }
});

module.exports = router;
