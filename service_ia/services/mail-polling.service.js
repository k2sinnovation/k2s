// service_ia/services/mail-polling.service.js

// ❌ NE PAS FAIRE ÇA (import circulaire)
// const mailPollingService = require('./mail-polling.service');
// const mailPollingService = require('./services/mail-polling.service');

// ✅ Imports corrects
const { google } = require('googleapis');
const User = require('../models/user.model'); // Ajustez le chemin
const aiService = require('./ai.service'); // Pour analyser les emails
const emailService = require('./email.service'); // Pour envoyer les réponses

class MailPollingService {
  
  /**
   * Vérifie les emails non lus pour tous les utilisateurs
   */
  async checkAllUsers() {
    console.log('🔍 === Début vérification tous utilisateurs ===');
    
    try {
      // Récupérer tous les utilisateurs avec IA activée
      const users = await User.find({ aiEnabled: true });
      
      console.log(`👥 Utilisateurs trouvés avec IA activée: ${users.length}`);
      
      if (users.length === 0) {
        console.log('⚠️  Aucun utilisateur avec IA activée');
        return { checked: 0, processed: 0 };
      }
      
      let processedCount = 0;
      
      // Vérifier chaque utilisateur
      for (const user of users) {
        try {
          console.log(`\n👤 Traitement utilisateur: ${user.email}`);
          const result = await this.checkUserEmails(user);
          
          if (result.processed > 0) {
            processedCount += result.processed;
            console.log(`✅ ${result.processed} email(s) traité(s) pour ${user.email}`);
          } else {
            console.log(`📭 Aucun nouveau message pour ${user.email}`);
          }
          
        } catch (err) {
          console.error(`❌ Erreur pour ${user.email}:`, err.message);
          // Continuer avec les autres utilisateurs
        }
      }
      
      console.log(`\n✅ === Fin vérification: ${processedCount} email(s) traité(s) ===\n`);
      
      return {
        checked: users.length,
        processed: processedCount
      };
      
    } catch (err) {
      console.error('❌ Erreur globale checkAllUsers:', err);
      throw err;
    }
  }
  
  /**
   * Vérifie les emails non lus pour un utilisateur spécifique
   */
  async checkUserEmails(user) {
    console.log(`📬 Vérification emails pour: ${user.email}`);
    
    // Vérifier que l'IA est activée
    if (!user.aiEnabled) {
      console.log(`⏭️  IA désactivée pour ${user.email}`);
      return { processed: 0 };
    }
    
    // Vérifier les tokens OAuth
    if (!user.googleTokens?.access_token) {
      console.error(`❌ Pas de token OAuth pour ${user.email}`);
      return { processed: 0 };
    }
    
    try {
      // Configurer OAuth2
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );
      
      oauth2Client.setCredentials({
        access_token: user.googleTokens.access_token,
        refresh_token: user.googleTokens.refresh_token,
        expiry_date: user.googleTokens.expiry_date
      });
      
      // Vérifier si le token doit être rafraîchi
      if (oauth2Client.isTokenExpiring()) {
        console.log('🔄 Rafraîchissement du token...');
        const { credentials } = await oauth2Client.refreshAccessToken();
        
        // Mettre à jour les tokens en base
        user.googleTokens = credentials;
        await user.save();
        
        oauth2Client.setCredentials(credentials);
      }
      
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      
      // Récupérer les messages non lus
      console.log('📥 Recherche messages non lus...');
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread in:inbox',
        maxResults: 10 // Limiter pour éviter la surcharge
      });
      
      const messages = response.data.messages || [];
      console.log(`📨 Messages non lus trouvés: ${messages.length}`);
      
      if (messages.length === 0) {
        return { processed: 0 };
      }
      
      let processed = 0;
      
      // Traiter chaque message
      for (const message of messages) {
        try {
          console.log(`\n📧 Traitement message ID: ${message.id}`);
          
          // Récupérer le contenu complet
          const fullMessage = await gmail.users.messages.get({
            userId: 'me',
            id: message.id,
            format: 'full'
          });
          
          // Extraire les informations
          const headers = fullMessage.data.payload.headers;
          const subject = headers.find(h => h.name === 'Subject')?.value || 'Sans sujet';
          const from = headers.find(h => h.name === 'From')?.value || 'Inconnu';
          const messageId = headers.find(h => h.name === 'Message-ID')?.value;
          
          console.log(`  De: ${from}`);
          console.log(`  Sujet: ${subject}`);
          
          // Extraire le corps du message
          const body = this.extractEmailBody(fullMessage.data.payload);
          
          if (!body || body.trim().length === 0) {
            console.log('⚠️  Corps du message vide, skip');
            continue;
          }
          
          console.log(`  Corps: ${body.substring(0, 100)}...`);
          
          // Analyser avec l'IA
          console.log('🤖 Analyse IA en cours...');
          const aiResponse = await aiService.analyzeEmail({
            from,
            subject,
            body,
            user: user.email
          });
          
          if (!aiResponse || !aiResponse.shouldReply) {
            console.log('⏭️  IA décide de ne pas répondre');
            
            // Marquer comme lu quand même
            await gmail.users.messages.modify({
              userId: 'me',
              id: message.id,
              requestBody: {
                removeLabelIds: ['UNREAD']
              }
            });
            
            continue;
          }
          
          console.log('✉️  Envoi de la réponse...');
          
          // Envoyer la réponse
          await emailService.sendReply({
            gmail,
            to: from,
            subject: `Re: ${subject}`,
            body: aiResponse.replyText,
            inReplyTo: messageId,
            threadId: fullMessage.data.threadId
          });
          
          // Marquer comme lu
          await gmail.users.messages.modify({
            userId: 'me',
            id: message.id,
            requestBody: {
              removeLabelIds: ['UNREAD']
            }
          });
          
          processed++;
          console.log('✅ Message traité avec succès');
          
        } catch (err) {
          console.error(`❌ Erreur traitement message ${message.id}:`, err.message);
          // Continuer avec les autres messages
        }
      }
      
      return { processed };
      
    } catch (err) {
      console.error(`❌ Erreur checkUserEmails pour ${user.email}:`, err);
      throw err;
    }
  }
  
  /**
   * Extrait le corps du message (texte brut ou HTML)
   */
  extractEmailBody(payload) {
    let body = '';
    
    // Cas 1: Corps directement dans le payload
    if (payload.body?.data) {
      body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }
    
    // Cas 2: Corps dans les parts (multipart)
    else if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          body = Buffer.from(part.body.data, 'base64').toString('utf-8');
          break;
        }
        // Fallback sur HTML si pas de texte brut
        if (part.mimeType === 'text/html' && part.body?.data && !body) {
          const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
          // Retirer les balises HTML basiques
          body = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        }
      }
    }
    
    return body.trim();
  }
}

// ✅ Exporter une INSTANCE unique (singleton)
module.exports = new MailPollingService();
