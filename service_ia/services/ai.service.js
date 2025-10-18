const axios = require('axios');
const contextBuilder = require('./context-builder.service');

class AIService {
  
 /**
 * 🔍 Analyser un message (avec historique optionnel)
 */
async analyzeMessage(message, user, conversationHistory = []) {
  const settings = user.aiSettings;
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('Clé API OpenAI manquante');
  }

  console.log(`[AI:${user._id}] 🤖 Analyse message...`);

  // ✅ NOUVEAU : CHARGER CONTEXTE DEPUIS DRIVE
  const accessToken = user.emailConfig?.accessToken;
  let driveContext = '';
  
  if (accessToken) {
    try {
      driveContext = await contextBuilder.buildContextFromDrive(
        accessToken, 
        user._id.toString(),
        { includeAppointments: false } // Pas besoin des RDV pour l'analyse
      );
      console.log(`[AI:${user._id}] ✅ Contexte Drive chargé (${driveContext.length} caractères)`);
    } catch (driveError) {
      console.warn(`[AI:${user._id}] ⚠️ Impossible de charger Drive:`, driveError.message);
      driveContext = contextBuilder._buildMinimalContext();
    }
  } else {
    console.warn(`[AI:${user._id}] ⚠️ Pas de token Gmail, contexte minimal`);
    driveContext = contextBuilder._buildMinimalContext();
  }

  // ✅ CONSTRUIRE LE PROMPT D'ANALYSE AVEC CONTEXTE DRIVE
  const analysisPrompt = contextBuilder.buildAnalysisPrompt(
    driveContext,
    message.body,
    conversationHistory
  );

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: analysisPrompt }
        ],
        temperature: 0.3, // Plus bas pour analyse précise
        max_tokens: 150
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const content = response.data.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);

    console.log(`[AI:${user._id}] ✅ Analyse terminée: ${analysis.intent} (${(analysis.confidence * 100).toFixed(0)}%)`);

    return analysis;

  } catch (error) {
    console.error(`[AI:${user._id}] ❌ Erreur analyse:`, error.message);
    if (error.response) {
      console.error('Détails:', error.response.data);
    }
    throw error;
  }
}

/**
 * 🤖 Générer une réponse (avec historique conversation)
 */
async generateResponse(message, analysis, user, conversationHistory = []) {
  const settings = user.aiSettings;
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('Clé API OpenAI manquante');
  }

  console.log(`[AI:${user._id}] 💬 Génération réponse...`);

  if (!analysis.is_relevant) {
    return this._generateOutOfScopeResponse(settings, user);
  }

  // ✅ NOUVEAU : CHARGER CONTEXTE DEPUIS DRIVE
  const accessToken = user.emailConfig?.accessToken;
  let driveContext = '';
  
  if (accessToken) {
    try {
      driveContext = await contextBuilder.buildContextFromDrive(
        accessToken, 
        user._id.toString(),
        { includeAppointments: true } // Inclure les RDV pour les réponses
      );
      console.log(`[AI:${user._id}] ✅ Contexte Drive chargé (${driveContext.length} caractères)`);
    } catch (driveError) {
      console.warn(`[AI:${user._id}] ⚠️ Impossible de charger Drive:`, driveError.message);
      driveContext = contextBuilder._buildMinimalContext();
    }
  } else {
    console.warn(`[AI:${user._id}] ⚠️ Pas de token Gmail, contexte minimal`);
    driveContext = contextBuilder._buildMinimalContext();
  }

  // ✅ CONSTRUIRE LE PROMPT DE RÉPONSE AVEC CONTEXTE DRIVE
  const responsePrompt = contextBuilder.buildResponsePrompt(
    driveContext,
    message.body,
    analysis,
    conversationHistory
  );

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: settings.aiModel || 'gpt-4',
        messages: [
          { role: 'system', content: responsePrompt }
        ],
        temperature: settings.temperature || 0.7,
        max_tokens: settings.maxTokens || 500
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const generatedResponse = response.data.choices[0].message.content;
    
    console.log(`[AI:${user._id}] ✅ Réponse générée (${generatedResponse.length} caractères)`);

    return generatedResponse;

  } catch (error) {
    console.error(`[AI:${user._id}] ❌ Erreur génération:`, error.message);
    if (error.response) {
      console.error('Détails:', error.response.data);
    }
    throw error;
  }
}

// ✅ GARDER LA FONCTION _generateOutOfScopeResponse INCHANGÉE
_generateOutOfScopeResponse(settings, user) {
  return `Bonjour,

Merci pour votre message.

Je suis un assistant automatique dédié uniquement aux demandes concernant ${settings.salonName || user.businessName} (rendez-vous, prestations, horaires).

Pour toute autre demande, contactez :
📧 ${settings.ownerEmail || user.email}
📞 ${settings.ownerPhone || 'Nous contacter'}

Cordialement,
Assistant ${settings.salonName || user.businessName}`;
}
}

module.exports = new AIService();
