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

    // Deep link vers l'app mobile
const deepLink = `k2sdiag://auth?access_token=${encodedAccessToken}&refresh_token=${encodedRefreshToken}&email=${encodedEmail}&id_token=${encodedIdToken}`;

console.log('🔗 [OAuth Google] Redirection vers l\'app mobile');

// Redirection HTTP 302 → FlutterWebAuth2 capture automatiquement le callback
res.redirect(deepLink);


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
