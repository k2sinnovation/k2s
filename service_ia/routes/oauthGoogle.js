const express = require('express');
const router = express.Router();
const axios = require('axios');
const User = require('../models/User');
const Session = require('../models/Session');

const GOOGLE_CLIENT_ID = '461385830578-pbnq271ga15ggms5c4uckspo4480litm.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const REDIRECT_URI = 'https://k2s.onrender.com/oauth/google/callback';

// ========================================
// ROUTE CALLBACK OAUTH GOOGLE
// ========================================

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

    // Créer ou mettre à jour utilisateur
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

    // Générer session token
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

    // ✅ CHOISIR LA VERSION (commentez celle que vous ne voulez pas)
    
    // VERSION 1: Auto-ouverture avec bouton de secours (recommandé)
    res.send(generateHtmlRedirect(deepLink, '✓ Connexion réussie', email));
    
    // VERSION 2: Avec bouton de confirmation (décommentez si préféré)
    // res.send(generateHtmlRedirectWithConfirm(deepLink, '✓ Connexion réussie', email));

  } catch (error) {
    console.error('❌ [OAuth] Erreur:', error.message);
    const deepLink = `k2sdiag://auth?error=server_error&error_description=${encodeURIComponent(error.message)}`;
    res.send(generateHtmlRedirect(deepLink, '❌ Erreur serveur', error.message));
  }
});

// ========================================
// VERSION 1: AUTO-OUVERTURE (1 TENTATIVE)
// ========================================

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
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">${icon}</div>
        <h1>${title}</h1>
        ${message ? `<div class="message">${message}</div>` : ''}
        
        <div id="status">
          Ouverture de l'application...
          <div class="spinner"></div>
        </div>
        
        <a href="${deepLink}" class="manual-link" id="manualBtn">
          📱 Ouvrir l'application
        </a>
      </div>
      
      <script>
        const deepLink = ${JSON.stringify(deepLink)};
        let appOpened = false;
        let redirectAttempted = false;
        
        console.log('🔗 Préparation redirection...');
        
        // ✅ DÉTECTION D'OUVERTURE APP
        function onAppOpened() {
          if (appOpened) return;
          appOpened = true;
          
          console.log('✅ Application ouverte');
          document.getElementById('status').innerHTML = 
            '✅ Retour à l\'application...<div style="margin-top:10px; font-size:14px; opacity:0.8;">Vous pouvez fermer cette page</div>';
          
          // Tentative de fermeture automatique
          setTimeout(() => {
            try { window.close(); } catch(e) {
              console.log('Fermeture auto impossible, affichage message');
            }
          }, 1500);
        }
        
        // ✅ FONCTION DE REDIRECTION (UNE SEULE FOIS)
        function attemptRedirect() {
          if (redirectAttempted) {
            console.log('⚠️ Redirection déjà tentée, abandon');
            return;
          }
          redirectAttempted = true;
          
          console.log('🚀 Redirection vers app...');
          
          // Détecter si on revient sur la page (échec redirection)
          const startTime = Date.now();
          
          window.location.href = deepLink;
          
          // Si après 2s on est toujours là, c'est que ça a échoué
          setTimeout(() => {
            if (!appOpened) {
              const elapsed = Date.now() - startTime;
              console.log(\`⚠️ Toujours sur la page après \${elapsed}ms\`);
              
              // Afficher le bouton manuel
              document.getElementById('manualBtn').style.display = 'inline-block';
              document.getElementById('status').innerHTML = 
                '⚠️ Ouverture automatique impossible<div style="margin-top:10px; font-size:14px;">Cliquez sur le bouton ci-dessous</div>';
            }
          }, 2000);
        }
        
        // Événements de détection (avant la redirection pour iOS)
        window.addEventListener('blur', () => {
          console.log('📱 blur détecté');
          onAppOpened();
        });
        
        window.addEventListener('pagehide', () => {
          console.log('📱 pagehide détecté');
          onAppOpened();
        });
        
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) {
            console.log('📱 visibilitychange (hidden) détecté');
            onAppOpened();
          }
        });
        
        // ✅ REDIRECTION UNIQUE APRÈS 100MS
        setTimeout(attemptRedirect, 100);
        
        // ✅ BOUTON MANUEL après 3s si toujours là
        setTimeout(() => {
          if (!appOpened && !redirectAttempted) {
            console.log('🔘 Affichage bouton manuel (timeout)');
            document.getElementById('manualBtn').style.display = 'inline-block';
            document.getElementById('status').style.display = 'none';
          }
        }, 3000);
        
        // ✅ ARRÊT DÉFINITIF après 10s (éviter boucle infinie)
        setTimeout(() => {
          if (!appOpened) {
            console.log('⏱️ Timeout 10s atteint, arrêt');
            document.getElementById('status').innerHTML = 
              '⚠️ Impossible d\'ouvrir automatiquement<div style="margin-top:10px; font-size:14px;">Utilisez le bouton ci-dessous</div>';
            document.getElementById('manualBtn').style.display = 'inline-block';
          }
        }, 10000);
      </script>
    </body>
    </html>
  `;
}

// ========================================
// VERSION 2: AVEC POPUP DE CONFIRMATION
// ========================================

function generateHtmlRedirectWithConfirm(deepLink, title, message) {
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
        .btn {
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
          transition: transform 0.2s;
        }
        .btn:hover {
          transform: scale(1.05);
        }
        .btn:active {
          transform: scale(0.95);
        }
        .spinner {
          display: inline-block;
          width: 20px;
          height: 20px;
          border: 3px solid rgba(255,255,255,0.3);
          border-radius: 50%;
          border-top-color: white;
          animation: spin 1s ease-in-out infinite;
          margin-left: 10px;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        #redirecting { display: none; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">${icon}</div>
        <h1>${title}</h1>
        ${message ? `<div class="message">${message}</div>` : ''}
        
        <div id="confirmSection">
          <button class="btn" id="openAppBtn">
            📱 Ouvrir l'application
          </button>
        </div>
        
        <div id="redirecting">
          Ouverture en cours...
          <div class="spinner"></div>
        </div>
      </div>
      
      <script>
        const deepLink = ${JSON.stringify(deepLink)};
        let appOpened = false;
        let userConfirmed = false;
        
        console.log('🔗 Popup de confirmation chargée');
        
        // ✅ DÉTECTION D'OUVERTURE APP
        function onAppOpened() {
          if (appOpened) return;
          appOpened = true;
          
          console.log('✅ Application ouverte');
          
          document.getElementById('confirmSection').style.display = 'none';
          document.getElementById('redirecting').style.display = 'block';
          document.getElementById('redirecting').innerHTML = 
            '✅ Retour à l\'application...<div style="margin-top:10px; font-size:14px;">Vous pouvez fermer cette page</div>';
          
          // Tentative de fermeture automatique
          setTimeout(() => {
            try { window.close(); } catch(e) {
              console.log('Fermeture auto impossible');
            }
          }, 2000);
        }
        
        // Événements de détection
        window.addEventListener('blur', () => {
          if (userConfirmed) {
            console.log('📱 blur détecté après confirmation');
            onAppOpened();
          }
        });
        
        window.addEventListener('pagehide', () => {
          if (userConfirmed) {
            console.log('📱 pagehide détecté après confirmation');
            onAppOpened();
          }
        });
        
        document.addEventListener('visibilitychange', () => {
          if (document.hidden && userConfirmed) {
            console.log('📱 visibilitychange détecté après confirmation');
            onAppOpened();
          }
        });
        
        // ✅ BOUTON DE CONFIRMATION (UNE SEULE POPUP)
        document.getElementById('openAppBtn').addEventListener('click', function() {
          if (userConfirmed) {
            console.log('⚠️ Déjà confirmé, abandon');
            return;
          }
          
          userConfirmed = true;
          console.log('👆 Utilisateur a confirmé');
          
          // Afficher l'état de chargement
          document.getElementById('confirmSection').style.display = 'none';
          document.getElementById('redirecting').style.display = 'block';
          
          // Redirection unique
          setTimeout(() => {
            console.log('🚀 Redirection vers app...');
            window.location.href = deepLink;
            
            // Si toujours là après 3s, c'est un échec
            setTimeout(() => {
              if (!appOpened) {
                console.log('⚠️ Échec ouverture app');
                document.getElementById('redirecting').innerHTML = 
                  '⚠️ Impossible d\'ouvrir l\'application<div style="margin-top:15px; font-size:14px;">Vérifiez que l\'application est installée</div>' +
                  '<button class="btn" onclick="location.reload()" style="margin-top:20px;">🔄 Réessayer</button>';
              }
            }, 3000);
          }, 300);
        });
        
        // ✅ AUTO-OUVERTURE APRÈS 2 SECONDES (optionnel)
        ${isSuccess ? `
        setTimeout(() => {
          if (!userConfirmed && !appOpened) {
            console.log('⏱️ Auto-clic après 2s');
            document.getElementById('openAppBtn').click();
          }
        }, 2000);
        ` : ''}
      </script>
    </body>
    </html>
  `;
}

module.exports = router;
