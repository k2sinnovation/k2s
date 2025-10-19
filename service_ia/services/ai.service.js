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

    console.log(`[AI:${user._id}] 🤖 Analyse message de "${message.from}"...`);

    // Charger contexte Drive
    const accessToken = user.emailConfig?.accessToken;
    let driveContext = '';
    
    if (accessToken) {
      try {
        driveContext = await contextBuilder.buildContextFromDrive(
          accessToken, 
          user._id.toString(),
          { includeAppointments: false }
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

    // Construire le prompt d'analyse
    const analysisPrompt = this._buildAnalysisSystemPrompt(driveContext);
    const userPrompt = this._buildAnalysisUserPrompt(message, conversationHistory);

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: analysisPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 200,
          response_format: { type: "json_object" } // ✅ FORCER JSON
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
      console.log(`[AI:${user._id}] 📝 Réponse brute OpenAI:`, content.substring(0, 200));

      // Parser la réponse JSON
      let analysis;
      try {
        analysis = JSON.parse(content);
      } catch (parseError) {
        console.error(`[AI:${user._id}] ❌ Erreur parsing JSON:`, parseError.message);
        console.error('Contenu reçu:', content);
        
        // Fallback : marquer comme non pertinent
        analysis = {
          is_relevant: false,
          confidence: 0.1,
          intent: 'unknown',
          reason: 'Erreur de parsing de la réponse IA'
        };
      }

      // ✅ NORMALISER LES CLÉS (snake_case vers camelCase si nécessaire)
      const normalizedAnalysis = {
        is_relevant: analysis.is_relevant ?? analysis.isRelevant ?? false,
        confidence: analysis.confidence ?? 0.5,
        intent: analysis.intent ?? 'unknown',
        reason: analysis.reason ?? analysis.details ?? 'Non spécifié',
        details: analysis.details ?? {}
      };

      console.log(`[AI:${user._id}] ✅ Analyse: ${normalizedAnalysis.intent} (${(normalizedAnalysis.confidence * 100).toFixed(0)}%) - Pertinent: ${normalizedAnalysis.is_relevant}`);

      return normalizedAnalysis;

    } catch (error) {
      console.error(`[AI:${user._id}] ❌ Erreur analyse:`, error.message);
      if (error.response) {
        console.error('Détails API:', error.response.data);
      }
      
      // Retourner une analyse par défaut en cas d'erreur
      return {
        is_relevant: false,
        confidence: 0.0,
        intent: 'error',
        reason: `Erreur IA: ${error.message}`
      };
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

    console.log(`[AI:${user._id}] 💬 Génération réponse pour intent="${analysis.intent}"...`);

    // Si non pertinent, réponse standard
    if (!analysis.is_relevant) {
      return this._generateOutOfScopeResponse(settings, user);
    }

    // Charger contexte Drive
    const accessToken = user.emailConfig?.accessToken;
    let driveContext = '';
    
    if (accessToken) {
      try {
        driveContext = await contextBuilder.buildContextFromDrive(
          accessToken, 
          user._id.toString(),
          { includeAppointments: true }
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

    // Construire le prompt de réponse
    const systemPrompt = this._buildResponseSystemPrompt(driveContext, settings);
    const userPrompt = this._buildResponseUserPrompt(message, analysis, conversationHistory);

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: settings.aiModel || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
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

      const generatedResponse = response.data.choices[0].message.content.trim();
      
      console.log(`[AI:${user._id}] ✅ Réponse générée (${generatedResponse.length} caractères)`);

      return generatedResponse;

    } catch (error) {
      console.error(`[AI:${user._id}] ❌ Erreur génération:`, error.message);
      if (error.response) {
        console.error('Détails API:', error.response.data);
      }
      
      // Réponse de secours
      return `Bonjour,\n\nMerci pour votre message. Nous avons bien reçu votre demande et nous vous répondrons dans les plus brefs délais.\n\nCordialement,\n${settings.salonName || user.businessName}`;
    }
  }

  /**
   * 📝 Construire le prompt système pour l'ANALYSE
   */
  _buildAnalysisSystemPrompt(driveContext) {
    return `${driveContext}

---

Tu es un expert en analyse de messages clients pour un salon/commerce.

**TÂCHE** : Analyse le message suivant et détermine s'il est pertinent pour l'entreprise.

**CRITÈRES DE PERTINENCE** :
- ✅ Pertinent : demande de rendez-vous, question sur prestations, horaires, tarifs, annulation/modification RDV
- ❌ Non pertinent : spam, publicité, newsletter externe, notification automatique (TikTok, LinkedIn, etc.)

**RÉPONDS UNIQUEMENT EN JSON VALIDE** avec cette structure exacte :
{
  "is_relevant": true/false,
  "confidence": 0.0 à 1.0,
  "intent": "prise_rdv" | "question_info" | "annulation" | "modification" | "reclamation" | "spam" | "autre",
  "reason": "Explication courte de ta décision",
  "details": {
    "date_souhaitee": "si mentionnée",
    "prestation_souhaitee": "si mentionnée"
  }
}`;
  }

  /**
   * 📝 Construire le prompt utilisateur pour l'ANALYSE
   */
  _buildAnalysisUserPrompt(message, conversationHistory) {
    let prompt = '';

    if (conversationHistory.length > 0) {
      prompt += '**HISTORIQUE CONVERSATION** :\n';
      conversationHistory.slice(-3).forEach(msg => {
        prompt += `- De: ${msg.from}\n  Message: ${msg.body.substring(0, 100)}...\n\n`;
      });
    }

    prompt += `**MESSAGE À ANALYSER** :
De: ${message.from}
Sujet: ${message.subject || '(sans objet)'}

Corps:
${message.body}

---
Analyse ce message et réponds en JSON.`;

    return prompt;
  }

  /**
   * 📝 Construire le prompt système pour la RÉPONSE
   */
  _buildResponseSystemPrompt(driveContext, settings) {
    const tone = settings.tone || 'professionnel';
    
    return `${driveContext}

---

Tu es ${settings.role || 'un assistant virtuel'} pour ${settings.salonName || 'cette entreprise'}.

**INSTRUCTIONS** :
${settings.instructions || 'Sois professionnel et courtois.'}

**TON** : ${tone}

**RÈGLES** :
1. Réponds en français naturel et fluide
2. Sois concis (3-5 phrases maximum)
3. Utilise les informations du contexte Drive pour personnaliser
4. Propose des créneaux concrets si pertinent
5. Termine toujours par une formule de politesse
6. N'invente JAMAIS d'informations non présentes dans le contexte

**FORMAT DE RÉPONSE** : Texte brut uniquement (pas de JSON, pas de markdown).`;
  }

  /**
   * 📝 Construire le prompt utilisateur pour la RÉPONSE
   */
  _buildResponseUserPrompt(message, analysis, conversationHistory) {
    let prompt = '';

    if (conversationHistory.length > 0) {
      prompt += '**HISTORIQUE CONVERSATION** :\n';
      conversationHistory.slice(-3).forEach(msg => {
        prompt += `- ${msg.from}: ${msg.body.substring(0, 80)}...\n`;
      });
      prompt += '\n';
    }

    prompt += `**MESSAGE CLIENT** :
De: ${message.from}
Sujet: ${message.subject || '(sans objet)'}

${message.body}

---

**ANALYSE DÉTECTÉE** :
- Intention: ${analysis.intent}
- Confiance: ${(analysis.confidence * 100).toFixed(0)}%
${analysis.details?.date_souhaitee ? `- Date souhaitée: ${analysis.details.date_souhaitee}` : ''}
${analysis.details?.prestation_souhaitee ? `- Prestation: ${analysis.details.prestation_souhaitee}` : ''}

Génère une réponse professionnelle et personnalisée.`;

    return prompt;
  }

  /**
   * 📧 Réponse standard pour messages hors scope
   */
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
