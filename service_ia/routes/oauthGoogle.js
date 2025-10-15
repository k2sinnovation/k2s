const express = require('express');
const router = express.Router();
const axios = require('axios');

// ✅ Configuration OAuth Google
const GOOGLE_CLIENT_ID = '461385830578-pbnq271ga15ggms5c4uckspo4480litm.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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'; 
const REDIRECT_URI = 'https://k2s.onrender.com/oauth/google/callback';

/**
 * GET /oauth/google/callback
 * Callback OAuth Google après authentification
 */
router.get('/oauth/google/callback', async (req, res) => {
  try {
    const { code, error, error_description } = req.query;

    console.log('📨 [OAuth Google] Callback reçu');
    console.log('Code:', code ? `${code.substring(0, 20)}...` : 'absent');
    console.log('Error:', error || 'aucune');

    // Gérer les erreurs OAuth
    if (error) {
      console.error('❌ [OAuth Google] Erreur:', error, error_description);
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body {
              font-family: Arial, sans-serif;
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
              background: rgba(255, 255, 255, 0.1);
              border-radius: 20px;
              backdrop-filter: blur(10px);
              max-width: 500px;
            }
            h1 { margin: 0 0 20px 0; }
            .error { 
              background: rgba(255, 255, 255, 0.2);
              padding: 15px;
              border-radius: 10px;
              margin: 20px 0;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Erreur OAuth</h1>
            <div class="error">
              <strong>Erreur :</strong> ${error}<br>
              ${error_description ? `<strong>Description :</strong> ${error_description}` : ''}
            </div>
            <p>Fermez cette fenêtre et réessayez.</p>
            <script>
              setTimeout(() => {
                window.close();
              }, 5000);
            </script>
          </div>
        </body>
        </html>
      `);
    }

    if (!code) {
      return res.status(400).send('Code OAuth manquant');
    }

    console.log('🔄 [OAuth Google] Échange du code contre tokens...');

    // Échanger le code contre des tokens
    const tokenResponse = await axios.post(
      'https://oauth2.googleapis.com/token',
      {
        code: code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      },
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    const { access_token, refresh_token, id_token } = tokenResponse.data;

    console.log('✅ [OAuth Google] Tokens reçus');
    console.log('Access token:', access_token ? 'présent' : 'absent');
    console.log('Refresh token:', refresh_token ? 'présent' : 'absent');

    // Récupérer l'email de l'utilisateur
    const userInfoResponse = await axios.get(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: { Authorization: `Bearer ${access_token}` }
      }
    );

    const email = userInfoResponse.data.email;
    console.log('✅ [OAuth Google] Email récupéré:', email);

    // Encoder les tokens pour l'URL
    const encodedAccessToken = encodeURIComponent(access_token);
    const encodedRefreshToken = encodeURIComponent(refresh_token || '');
    const encodedEmail = encodeURIComponent(email);
    const encodedIdToken = encodeURIComponent(id_token || '');

    // Deep link vers l'app mobile
    const deepLink = `k2sdiag://auth?access_token=${encodedAccessToken}&refresh_token=${encodedRefreshToken}&email=${encodedEmail}&id_token=${encodedIdToken}`;

    console.log('🔗 [OAuth Google] Redirection vers l\'app mobile');

    // Page de redirection avec design moderne ET bouton manuel
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Connexion réussie</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
          }
          .container {
            text-align: center;
            padding: 50px 40px;
            background: rgba(255, 255, 255, 0.15);
            border-radius: 30px;
            backdrop-filter: blur(20px);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            max-width: 400px;
            width: 100%;
            animation: fadeIn 0.5s ease-in;
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .success-icon {
            width: 80px;
            height: 80px;
            margin: 0 auto 30px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 50px;
          }
          h1 {
            font-size: 28px;
            margin-bottom: 15px;
            font-weight: 600;
          }
          p {
            font-size: 16px;
            opacity: 0.9;
            margin-bottom: 20px;
          }
          .user-info {
            background: rgba(255, 255, 255, 0.1);
            padding: 15px;
            border-radius: 15px;
            margin-bottom: 25px;
            font-size: 14px;
          }
          .btn-container {
            margin: 30px 0;
          }
          .btn-open {
            display: inline-block;
            padding: 18px 40px;
            background: white;
            color: #667eea;
            text-decoration: none;
            border-radius: 50px;
            font-weight: bold;
            font-size: 18px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
            transition: all 0.3s ease;
            cursor: pointer;
            border: none;
          }
          .btn-open:hover {
            transform: translateY(-2px);
            box-shadow: 0 15px 40px rgba(0, 0, 0, 0.3);
          }
          .btn-open:active {
            transform: translateY(0);
          }
          .spinner {
            border: 4px solid rgba(255, 255, 255, 0.3);
            border-top: 4px solid white;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
            display: none;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .footer {
            margin-top: 25px;
            font-size: 12px;
            opacity: 0.7;
          }
          .status {
            margin-top: 15px;
            padding: 10px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            font-size: 13px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">✅</div>
          <h1>Connexion réussie !</h1>
          <div class="user-info">
            📧 ${email}
          </div>
          
          <div class="btn-container">
            <button class="btn-open" onclick="openApp()">
              🚀 Ouvrir K2S Diag
            </button>
          </div>
          
          <div class="spinner" id="spinner"></div>
          <div class="status" id="status">
            Tentative de redirection automatique...
          </div>
          
          <div class="footer">
            L'application devrait s'ouvrir automatiquement.<br>
            Si ce n'est pas le cas, cliquez sur le bouton ci-dessus.
          </div>
        </div>
        <script>
          const deepLink = '${deepLink}';
          let attempts = 0;
          const maxAttempts = 5;
          
          console.log('Deep link:', deepLink);
          
          // Extraire les paramètres pour affichage
          const url = new URL(deepLink);
          const email = url.searchParams.get('email') || '';
          const hasToken = url.searchParams.get('access_token') ? 'Oui' : 'Non';
          
          function openApp() {
            document.getElementById('spinner').style.display = 'block';
            document.getElementById('status').innerHTML = \`
              Tentative d'ouverture n°\${attempts + 1}...<br>
              <small>Email: \${email}</small><br>
              <small>Token: \${hasToken}</small>
            \`;
            
            // Méthode 1 : window.location
            window.location.href = deepLink;
            
            // Méthode 2 : Créer un iframe invisible
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = deepLink;
            document.body.appendChild(iframe);
            
            // Méthode 3 : Créer un lien et cliquer dessus
            const link = document.createElement('a');
            link.href = deepLink;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            
            // Vérifier après 2 secondes
            setTimeout(() => {
              document.getElementById('spinner').style.display = 'none';
              
              if (document.hasFocus()) {
                // Toujours sur la page = l'app ne s'est pas ouverte
                attempts++;
                
                if (attempts < maxAttempts) {
                  document.getElementById('status').innerHTML = \`
                    ⚠️ L'application ne s'est pas ouverte.<br>
                    Nouvelle tentative dans 1 seconde...<br>
                    <small>Tentative \${attempts}/\${maxAttempts}</small>
                  \`;
                } else {
                  document.getElementById('status').innerHTML = \`
                    ❌ Impossible d'ouvrir l'application automatiquement.<br><br>
                    <strong>Solution manuelle :</strong><br>
                    1. Fermez cette page<br>
                    2. Retournez dans l'application K2S Diag<br>
                    3. Réessayez de vous connecter<br><br>
                    <small>Si le problème persiste, contactez le support.</small>
                  \`;
                  
                  // Copier le deep link dans le presse-papiers
                  navigator.clipboard.writeText(deepLink).then(() => {
                    document.getElementById('status').innerHTML += \`<br><br>
                      📋 Le lien de connexion a été copié dans le presse-papiers.
                    \`;
                  }).catch(() => {});
                }
              }
            }, 2000);
          }
          
          // Essayer automatiquement au chargement
          function autoRedirect() {
            if (attempts < maxAttempts) {
              openApp();
              setTimeout(autoRedirect, 3000);
            }
          }
          
          // Lancer après un court délai
          setTimeout(autoRedirect, 500);
        </script>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('❌ [OAuth Google] Erreur:', error.message);
    console.error('Stack:', error.stack);

    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body {
            font-family: Arial, sans-serif;
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
            background: rgba(255, 255, 255, 0.1);
            border-radius: 20px;
            backdrop-filter: blur(10px);
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Erreur serveur</h1>
          <p>Une erreur est survenue lors de la connexion.</p>
          <p style="font-size: 14px; opacity: 0.8; margin-top: 20px;">
            ${error.message}
          </p>
          <p style="margin-top: 30px;">Fermez cette fenêtre et réessayez.</p>
        </div>
      </body>
      </html>
    `);
  }
});

module.exports = router;
