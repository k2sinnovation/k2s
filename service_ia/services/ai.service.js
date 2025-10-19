// service_ia/services/ai.service.js
// ✅ VERSION CORRIGÉE - Modèle Mistral correct

const axios = require('axios');
const contextBuilder = require('./context-builder.service');

class AIService {
  
  /**
   * 🎯 MÉTHODE OPTIMISÉE
   * Analyse + Génération en 1 SEUL appel Mistral
   */
  async analyzeAndGenerateResponse(message, user, conversationHistory = [], driveData = null) {
    const settings = user.aiSettings;
    const apiKey = process.env.K2S_IQ;
    
    if (!apiKey) {
      throw new Error('Clé API Mistral manquante (K2S_IQ)');
    }

    console.log(`[AI:${user._id}] 🤖 Analyse + Génération en 1 appel...`);

    // ✅ Charger contexte Drive
    const accessToken = user.emailConfig?.accessToken;
    let driveContext = '';
    
    if (driveData) {
      driveContext = this._buildContextFromDriveData(driveData);
      console.log(`[AI:${user._id}] ✅ Contexte Drive depuis cache (${driveContext.length} chars)`);
    } else if (accessToken) {
      try {
        driveContext = await contextBuilder.buildContextFromDrive(
          accessToken, 
          user._id.toString(),
          { includeAppointments: true }
        );
        console.log(`[AI:${user._id}] ✅ Contexte Drive chargé (${driveContext.length} chars)`);
      } catch (driveError) {
        console.warn(`[AI:${user._id}] ⚠️ Erreur Drive:`, driveError.message);
        driveContext = contextBuilder._buildMinimalContext();
      }
    } else {
      driveContext = contextBuilder._buildMinimalContext();
    }

    // Construire le prompt COMBINÉ
    const systemPrompt = this._buildCombinedSystemPrompt(driveContext, settings);
    const userPrompt = this._buildCombinedUserPrompt(message, conversationHistory);

    try {
      // ✅ FIX: Utiliser le bon modèle Mistral depuis les settings OU par défaut
      const mistralModel = this._getMistralModel(settings.aiModel);
      
      console.log(`[AI:${user._id}] 📡 Appel Mistral: ${mistralModel}`);

      const requestBody = {
        model: mistralModel, // ✅ Modèle Mistral valide
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5,
        max_tokens: 800
      };

      const response = await axios.post(
        'https://api.mistral.ai/v1/chat/completions',
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      const content = response.data.choices[0].message.content;

      // Parser la réponse JSON
      let result;
      try {
        let cleanContent = content.trim();
        
        // Retirer les balises markdown
        if (cleanContent.startsWith('```json')) {
          cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/```\s*$/, '');
        } else if (cleanContent.startsWith('```')) {
          cleanContent = cleanContent.replace(/^```\s*/, '').replace(/```\s*$/, '');
        }
        
        result = JSON.parse(cleanContent);
      } catch (parseError) {
        console.error(`[AI:${user._id}] ❌ Erreur parsing JSON:`, parseError.message);
        console.error('Contenu brut:', content.substring(0, 500));
        return {
          analysis: {
            is_relevant: false,
            confidence: 0.1,
            intent: 'error',
            reason: 'Erreur parsing réponse IA'
          },
          response: null
        };
      }

      // Normaliser la réponse
      const normalizedResult = {
        analysis: {
          is_relevant: result.is_relevant ?? result.analysis?.is_relevant ?? false,
          confidence: result.confidence ?? result.analysis?.confidence ?? 0.5,
          intent: result.intent ?? result.analysis?.intent ?? 'unknown',
          reason: result.reason ?? result.analysis?.reason ?? 'Non spécifié',
          details: result.details ?? result.analysis?.details ?? {}
        },
        response: result.response ?? null
      };

      console.log(`[AI:${user._id}] ✅ Analyse: ${normalizedResult.analysis.intent} (${(normalizedResult.analysis.confidence * 100).toFixed(0)}%) - Pertinent: ${normalizedResult.analysis.is_relevant}`);
      
      if (normalizedResult.response) {
        console.log(`[AI:${user._id}] ✅ Réponse générée (${normalizedResult.response.length} chars)`);
      }

      return normalizedResult;

    } catch (error) {
      console.error(`[AI:${user._id}] ❌ Erreur IA combinée:`, error.message);
      if (error.response) {
        console.error('Détails API:', error.response.data);
      }
      
      return {
        analysis: {
          is_relevant: false,
          confidence: 0.0,
          intent: 'error',
          reason: `Erreur IA: ${error.message}`
        },
        response: null
      };
    }
  }

  /**
   * ✅ NOUVEAU : Mapper les modèles pour Mistral
   */
  _getMistralModel(userModel) {
    // Mapping des anciens noms vers Mistral
    const modelMapping = {
      'gpt-4': 'mistral-large-latest',
      'gpt-4o': 'mistral-large-latest',
      'gpt-4o-mini': 'mistral-small-latest',
      'gpt-3.5-turbo': 'mistral-small-latest',
      'mistral-large-latest': 'mistral-large-latest',
      'mistral-small-latest': 'mistral-small-latest',
      'mistral-medium-latest': 'mistral-medium-latest'
    };

    // Si le modèle est déjà Mistral, le retourner tel quel
    if (userModel && userModel.startsWith('mistral-')) {
      return userModel;
    }

    // Sinon, mapper ou utiliser le défaut
    return modelMapping[userModel] || 'mistral-small-latest';
  }

  /**
   * 📝 Construire le prompt système COMBINÉ
   */
  _buildCombinedSystemPrompt(driveContext, settings) {
    const tone = settings.tone || 'professionnel';
    
    return `${driveContext}

---

Tu es ${settings.role || 'un assistant virtuel'} pour ${settings.salonName || 'cette entreprise'}.

**INSTRUCTIONS** :
${settings.instructions || 'Sois professionnel et courtois.'}

**TON** : ${tone}

**TÂCHE EN 2 ÉTAPES** :

1️⃣ **ANALYSE** : Détermine si le message est pertinent
   - ✅ Pertinent : RDV, questions prestations/tarifs/horaires, annulation/modification
   - ❌ Non pertinent : spam, pub, newsletter, notification auto (TikTok, LinkedIn, Patreon, etc.)

2️⃣ **RÉPONSE** : Si pertinent, génère une réponse professionnelle
   - Utilise les infos du contexte Drive
   - Concis (3-5 phrases max)
   - Propose des créneaux concrets si pertinent
   - Termine par formule de politesse
   - N'invente JAMAIS d'infos non présentes

**FORMAT DE RÉPONSE STRICTEMENT JSON (aucun texte avant/après)** :
{
  "is_relevant": true/false,
  "confidence": 0.0 à 1.0,
  "intent": "prise_rdv"|"question_info"|"annulation"|"modification"|"reclamation"|"spam"|"autre",
  "reason": "Explication courte",
  "details": {
    "date_souhaitee": "si mentionnée",
    "prestation_souhaitee": "si mentionnée"
  },
  "response": "Ta réponse si is_relevant=true, sinon null"
}

IMPORTANT : Réponds UNIQUEMENT avec le JSON, rien d'autre.`;
  }

  /**
   * 📝 Construire le prompt utilisateur COMBINÉ
   */
  _buildCombinedUserPrompt(message, conversationHistory) {
    let prompt = '';

    if (conversationHistory.length > 0) {
      prompt += '**HISTORIQUE CONVERSATION** :\n';
      conversationHistory.slice(-3).forEach(msg => {
        prompt += `- ${msg.from}: ${msg.body.substring(0, 100)}...\n`;
      });
      prompt += '\n';
    }

    prompt += `**MESSAGE À ANALYSER ET RÉPONDRE** :
De: ${message.from}
Sujet: ${message.subject || '(sans objet)'}

Corps:
${message.body}

---

Analyse ce message ET génère une réponse appropriée si pertinent.
Réponds en JSON avec les champs: is_relevant, confidence, intent, reason, details, response`;

    return prompt;
  }

  /**
   * 🔨 Construire contexte depuis driveData
   */
  _buildContextFromDriveData(driveData) {
    if (!driveData) return '';
    
    let context = '**INFORMATIONS ENTREPRISE** :\n';
    
    if (driveData.businessInfo && !driveData.businessInfo._empty) {
      const biz = driveData.businessInfo;
      context += `- Nom: ${biz.name || 'N/A'}\n`;
      context += `- Description: ${biz.description || 'N/A'}\n`;
      if (biz.services?.length > 0) {
        context += `- Services: ${biz.services.join(', ')}\n`;
      }
      if (biz.prices) {
        context += `- Tarifs: ${JSON.stringify(biz.prices)}\n`;
      }
      if (biz.hours) {
        context += `- Horaires: ${JSON.stringify(biz.hours)}\n`;
      }
    }
    
    if (driveData.planningInfo && !driveData.planningInfo._empty) {
      const planning = driveData.planningInfo;
      context += `\n**DISPONIBILITÉS** :\n`;
      if (planning.availableSlots?.length > 0) {
        context += `- Créneaux dispos: ${planning.availableSlots.slice(0, 5).join(', ')}\n`;
      }
    }
    
    return context;
  }

  // ========================================
  // 🔄 MÉTHODES ANCIENNES (compatibilité)
  // ========================================

  async analyzeMessage(message, user, conversationHistory = []) {
    const settings = user.aiSettings;
    const apiKey = process.env.K2S_IQ;
    
    if (!apiKey) {
      throw new Error('Clé API Mistral manquante (K2S_IQ)');
    }

    console.log(`[AI:${user._id}] 🤖 Analyse message de "${message.from}"...`);

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
      driveContext = contextBuilder._buildMinimalContext();
    }

    const analysisPrompt = this._buildAnalysisSystemPrompt(driveContext);
    const userPrompt = this._buildAnalysisUserPrompt(message, conversationHistory);

    try {
      const mistralModel = this._getMistralModel(settings.aiModel);
      
      const requestBody = {
        model: mistralModel,
        messages: [
          { role: 'system', content: analysisPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 200
      };

      const response = await axios.post(
        'https://api.mistral.ai/v1/chat/completions',
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      const content = response.data.choices[0].message.content;
      let analysis = JSON.parse(content);

      const normalizedAnalysis = {
        is_relevant: analysis.is_relevant ?? analysis.isRelevant ?? false,
        confidence: analysis.confidence ?? 0.5,
        intent: analysis.intent ?? 'unknown',
        reason: analysis.reason ?? analysis.details ?? 'Non spécifié',
        details: analysis.details ?? {}
      };

      console.log(`[AI:${user._id}] ✅ Analyse: ${normalizedAnalysis.intent} (${(normalizedAnalysis.confidence * 100).toFixed(0)}%)`);

      return normalizedAnalysis;

    } catch (error) {
      console.error(`[AI:${user._id}] ❌ Erreur analyse:`, error.message);
      return {
        is_relevant: false,
        confidence: 0.0,
        intent: 'error',
        reason: `Erreur IA: ${error.message}`
      };
    }
  }

  async generateResponse(message, analysis, user, conversationHistory = []) {
    const settings = user.aiSettings;
    const apiKey = process.env.K2S_IQ;
    
    if (!apiKey) {
      throw new Error('Clé API Mistral manquante (K2S_IQ)');
    }

    console.log(`[AI:${user._id}] 💬 Génération réponse pour intent="${analysis.intent}"...`);

    if (!analysis.is_relevant) {
      return this._generateOutOfScopeResponse(settings, user);
    }

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
        driveContext = contextBuilder._buildMinimalContext();
      }
    } else {
      driveContext = contextBuilder._buildMinimalContext();
    }

    const systemPrompt = this._buildResponseSystemPrompt(driveContext, settings);
    const userPrompt = this._buildResponseUserPrompt(message, analysis, conversationHistory);

    try {
      const mistralModel = this._getMistralModel(settings.aiModel);
      
      const response = await axios.post(
        'https://api.mistral.ai/v1/chat/completions',
        {
          model: mistralModel,
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
      return `Bonjour,\n\nMerci pour votre message. Nous avons bien reçu votre demande et nous vous répondrons dans les plus brefs délais.\n\nCordialement,\n${settings.salonName || user.businessName}`;
    }
  }

  _buildAnalysisSystemPrompt(driveContext) {
    return `${driveContext}

---

Tu es un expert en analyse de messages clients pour un salon/commerce.

**TÂCHE** : Analyse le message suivant et détermine s'il est pertinent pour l'entreprise.

**CRITÈRES DE PERTINENCE** :
- ✅ Pertinent : demande de rendez-vous, question sur prestations, horaires, tarifs, annulation/modification RDV
- ❌ Non pertinent : spam, publicité, newsletter externe, notification automatique (TikTok, LinkedIn, Patreon, etc.)

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
