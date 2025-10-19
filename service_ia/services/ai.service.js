// service_ia/services/ai.service.js
// ✅ VERSION OPTIMISÉE - 1 seul appel OpenAI au lieu de 2

const axios = require('axios');
const contextBuilder = require('./context-builder.service');

class AIService {
  
  /**
   * 🎯 NOUVELLE MÉTHODE OPTIMISÉE
   * Analyse + Génération en 1 SEUL appel OpenAI
   * Économie : 50% de tokens et requêtes
   */
  async analyzeAndGenerateResponse(message, user, conversationHistory = [], driveData = null) {
    const settings = user.aiSettings;
    const apiKey = process.env.K2S_IQ;
    
    if (!apiKey) {
      throw new Error('Clé API OpenAI manquante');
    }

    console.log(`[AI:${user._id}] 🤖 Analyse + Génération en 1 appel...`);

    // ✅ Charger contexte Drive UNE SEULE FOIS (ou utiliser celui passé en param)
    const accessToken = user.emailConfig?.accessToken;
    let driveContext = '';
    
    if (driveData) {
      // Utiliser driveData déjà chargé (0 requête supplémentaire)
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
      // ✅ Construction de la requête avec response_format conditionnel
      const requestBody = {
        model: settings.aiModel || 'mistral-small-latest',
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

      // Parser la réponse JSON combinée
      let result;
      try {
        // ✅ Nettoyer la réponse avant parsing (enlever markdown si présent)
        let cleanContent = content.trim();
        
        // Retirer les balises markdown ```json et ```
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

      // ✅ Normaliser la réponse
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
   * 📝 Construire le prompt système COMBINÉ (analyse + génération)
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
   - ❌ Non pertinent : spam, pub, newsletter, notification auto (TikTok, LinkedIn, etc.)

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
   * 🔨 Construire contexte depuis driveData (évite rechargement)
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
  // Garder pour ne pas casser le code existant
  // ========================================

  /**
   * 🔍 Analyser un message (ANCIENNE VERSION - conservée pour compatibilité)
   */
  async analyzeMessage(message, user, conversationHistory = []) {
    const settings = user.aiSettings;
    const apiKey = process.env.OPENAI_API_KEY;
    
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
      // ✅ Construction de la requête avec response_format conditionnel
      const requestBody = {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: analysisPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 200
      };

      // Note: gpt-4o-mini ne supporte pas response_format
      // Si besoin de JSON strict, utiliser gpt-4o ou gpt-4-turbo

      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
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

  /**
   * 🤖 Générer une réponse (ANCIENNE VERSION - conservée pour compatibilité)
   */
  async generateResponse(message, analysis, user, conversationHistory = []) {
    const settings = user.aiSettings;
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('Clé API OpenAI manquante');
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
