// service_ia/services/ai.service.js
// ✅ VERSION SIMPLIFIÉE - 2 APPELS SÉPARÉS

const axios = require('axios');
const contextBuilder = require('./context-builder.service');

class AIService {
  
  /**
   * 🎯 MÉTHODE PRINCIPALE SIMPLIFIÉE
   * Analyse PUIS génère (si pertinent)
   */
  async analyzeAndGenerateResponse(message, user, conversationHistory = [], driveData = null) {
    const userId = user._id.toString();
    
    console.log(`[AI:${userId}] 🔍 Étape 1/2 : Analyse du message...`);
    
    // 1️⃣ ANALYSE SIMPLE (JSON minimal)
    const analysis = await this.analyzeMessage(message, user, conversationHistory, driveData);
    
    console.log(`[AI:${userId}] ✅ Analyse: ${analysis.intent} - Pertinent: ${analysis.is_relevant} (${(analysis.confidence * 100).toFixed(0)}%)`);
    
    // 2️⃣ Si non pertinent, on s'arrête là
    if (!analysis.is_relevant) {
      console.log(`[AI:${userId}] ⏭️ Message non pertinent, pas de réponse`);
      return {
        analysis,
        response: null
      };
    }
    
    // 3️⃣ GÉNÉRATION DE RÉPONSE (TEXTE PUR)
    console.log(`[AI:${userId}] 💬 Étape 2/2 : Génération de la réponse...`);
    
    const response = await this.generateResponse(message, analysis, user, conversationHistory, driveData);
    
    console.log(`[AI:${userId}] ✅ Réponse générée (${response.length} chars)`);
    
    return {
      analysis,
      response
    };
  }

  /**
   * 🔍 ANALYSE - Retourne JSON simple
   */
  async analyzeMessage(message, user, conversationHistory = [], driveData = null) {
    const settings = user.aiSettings;
    const apiKey = process.env.K2S_IQ;
    const userId = user._id.toString();
    
    if (!apiKey) {
      throw new Error('Clé API Mistral manquante (K2S_IQ)');
    }

    // Charger contexte Drive
    let driveContext = '';
    if (driveData) {
      driveContext = this._buildContextFromDriveData(driveData);
      console.log(`[AI:${userId}] ✅ Contexte Drive depuis cache (${driveContext.length} chars)`);
    } else {
      driveContext = await this._loadDriveContext(user, false);
    }

    const systemPrompt = this._buildAnalysisSystemPrompt(driveContext, settings);
    const userPrompt = this._buildAnalysisUserPrompt(message, conversationHistory);

    try {
      const mistralModel = this._getMistralModel(settings.aiModel);
      
      console.log(`[AI:${userId}] 📡 Appel Mistral Analyse: ${mistralModel}`);

      const response = await axios.post(
        'https://api.mistral.ai/v1/chat/completions',
        {
          model: mistralModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 300
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      const content = response.data.choices[0].message.content.trim();
      
      // Parser le JSON d'analyse
      let analysis = this._parseAnalysisJSON(content, userId);
      
      return {
        is_relevant: analysis.is_relevant ?? false,
        confidence: analysis.confidence ?? 0.5,
        intent: analysis.intent ?? 'unknown',
        reason: analysis.reason ?? 'Non spécifié',
        details: analysis.details ?? {}
      };

    } catch (error) {
      console.error(`[AI:${userId}] ❌ Erreur analyse:`, error.message);
      return {
        is_relevant: false,
        confidence: 0.0,
        intent: 'error',
        reason: `Erreur IA: ${error.message}`,
        details: {}
      };
    }
  }

  /**
   * 💬 GÉNÉRATION - Retourne TEXTE pur (pas de JSON)
   */
  async generateResponse(message, analysis, user, conversationHistory = [], driveData = null) {
    const settings = user.aiSettings;
    const apiKey = process.env.K2S_IQ;
    const userId = user._id.toString();
    
    if (!apiKey) {
      throw new Error('Clé API Mistral manquante (K2S_IQ)');
    }

    // Charger contexte Drive avec disponibilités
    let driveContext = '';
    if (driveData) {
      driveContext = this._buildContextFromDriveData(driveData);
    } else {
      driveContext = await this._loadDriveContext(user, true);
    }

    const systemPrompt = this._buildResponseSystemPrompt(driveContext, settings);
    const userPrompt = this._buildResponseUserPrompt(message, analysis, conversationHistory);

    try {
      const mistralModel = this._getMistralModel(settings.aiModel);
      
      console.log(`[AI:${userId}] 📡 Appel Mistral Génération: ${mistralModel}`);

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

      // ✅ SIMPLE : On retourne le texte brut, pas de JSON !
      const generatedResponse = response.data.choices[0].message.content.trim();
      
      return generatedResponse;

    } catch (error) {
      console.error(`[AI:${userId}] ❌ Erreur génération:`, error.message);
      
      // Fallback générique
      return `Bonjour,\n\nMerci pour votre message. Nous avons bien reçu votre demande et nous vous répondrons dans les plus brefs délais.\n\nCordialement,\n${settings.salonName || user.businessName}`;
    }
  }

  /**
   * 🔨 HELPER : Parser JSON d'analyse
   */
  _parseAnalysisJSON(content, userId) {
    try {
      let cleanContent = content.trim();
      
      // Retirer markdown
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.replace(/^```json\s*/s, '').replace(/```\s*$/s, '');
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```\s*/s, '').replace(/```\s*$/s, '');
      }
      
      // Extraire l'objet JSON
      const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanContent = jsonMatch[0];
      }
      
      return JSON.parse(cleanContent);
      
    } catch (error) {
      console.warn(`[AI:${userId}] ⚠️ Parsing JSON échoué, extraction manuelle...`);
      
      // Fallback : extraction regex
      const isRelevantMatch = content.match(/"is_relevant"\s*:\s*(true|false)/i);
      const intentMatch = content.match(/"intent"\s*:\s*"([^"]+)"/i);
      const confidenceMatch = content.match(/"confidence"\s*:\s*([0-9.]+)/);
      const reasonMatch = content.match(/"reason"\s*:\s*"([^"]+)"/i);
      
      if (isRelevantMatch) {
        return {
          is_relevant: isRelevantMatch[1] === 'true',
          confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5,
          intent: intentMatch ? intentMatch[1] : 'unknown',
          reason: reasonMatch ? reasonMatch[1] : 'Parsing partiel',
          details: {}
        };
      }
      
      // Dernière chance
      return {
        is_relevant: false,
        confidence: 0.1,
        intent: 'error',
        reason: 'Erreur parsing JSON',
        details: {}
      };
    }
  }

  /**
   * 🔨 HELPER : Charger contexte Drive
   */
  async _loadDriveContext(user, includeAppointments = false) {
    const accessToken = user.emailConfig?.accessToken;
    
    if (!accessToken) {
      return contextBuilder._buildMinimalContext();
    }
    
    try {
      const context = await contextBuilder.buildContextFromDrive(
        accessToken,
        user._id.toString(),
        { includeAppointments }
      );
      console.log(`[AI:${user._id}] ✅ Contexte Drive chargé (${context.length} chars)`);
      return context;
    } catch (error) {
      console.warn(`[AI:${user._id}] ⚠️ Drive non disponible:`, error.message);
      return contextBuilder._buildMinimalContext();
    }
  }

  /**
   * 🔨 HELPER : Construire contexte depuis driveData
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

  /**
   * 🔨 HELPER : Mapper modèles Mistral
   */
  _getMistralModel(userModel) {
    const modelMapping = {
      'gpt-4': 'mistral-large-latest',
      'gpt-4o': 'mistral-large-latest',
      'gpt-4o-mini': 'mistral-small-latest',
      'gpt-3.5-turbo': 'mistral-small-latest',
      'mistral-large-latest': 'mistral-large-latest',
      'mistral-small-latest': 'mistral-small-latest',
      'mistral-medium-latest': 'mistral-medium-latest'
    };

    if (userModel && userModel.startsWith('mistral-')) {
      return userModel;
    }

    return modelMapping[userModel] || 'mistral-small-latest';
  }

  /**
   * 📝 PROMPT : Analyse (JSON simple) - ENRICHI AVEC SETTINGS
   */
  _buildAnalysisSystemPrompt(driveContext, settings) {
    return `${driveContext}

---

Tu es ${settings.role || 'un assistant virtuel'} pour ${settings.salonName || 'cette entreprise'}.

**CONTEXTE ENTREPRISE** :
${settings.instructions ? settings.instructions : 'Analyse les messages clients pour déterminer leur pertinence.'}

**TÂCHE** : Analyse ce message et détermine s'il est pertinent pour ${settings.salonName || 'l\'entreprise'}.

**CRITÈRES** :
- ✅ Pertinent : RDV, questions prestations/tarifs/horaires, annulation, modification
- ❌ Non pertinent : spam, pub, newsletter, notification auto (Instagram, TikTok, etc.)

**RÉPONDS EN JSON UNIQUEMENT** (rien avant, rien après) :
{
  "is_relevant": true ou false,
  "confidence": 0.0 à 1.0,
  "intent": "prise_rdv"|"question_info"|"annulation"|"modification"|"reclamation"|"spam"|"autre",
  "reason": "Explication courte",
  "details": {
    "date_souhaitee": "si mentionnée ou null",
    "prestation_souhaitee": "si mentionnée ou null"
  }
}`;
  }

  /**
   * 📝 PROMPT : Génération (TEXTE pur attendu) - ULTRA PERSONNALISÉ
   */
  _buildResponseSystemPrompt(driveContext, settings) {
    const tone = settings.tone || 'professionnel';
    const salonName = settings.salonName || 'notre entreprise';
    
    return `${driveContext}

---

Tu es ${settings.role || 'un assistant virtuel'} pour ${salonName}.

**INSTRUCTIONS PERSONNALISÉES** :
${settings.instructions || 'Réponds de manière professionnelle et courtoise aux clients.'}

**TON À ADOPTER** : ${tone}

**RÈGLES STRICTES** :
1. Réponds en français naturel et fluide
2. Sois concis (3-5 phrases maximum)
3. **UTILISE IMPÉRATIVEMENT** les informations du contexte Drive ci-dessus (horaires, tarifs, disponibilités)
4. Propose des créneaux CONCRETS si disponibles dans le contexte
5. Termine toujours par une formule de politesse appropriée
6. N'invente JAMAIS d'informations non présentes dans le contexte
7. Signe tes messages avec "${salonName}" ou "L'équipe ${salonName}"

**IMPORTANT** : Réponds UNIQUEMENT avec le texte de l'email à envoyer. AUCUN JSON, AUCUNE explication, AUCUN commentaire.

Exemple de réponse IDÉALE :
"Bonjour,

Merci pour votre demande de rendez-vous. Je vous propose les créneaux suivants :
- Lundi 21 octobre à 14h
- Mardi 22 octobre à 10h

Faites-moi savoir ce qui vous convient le mieux.

Cordialement,
L'équipe ${salonName}"`;
  }

  /**
   * 📝 User prompt pour analyse
   */
  _buildAnalysisUserPrompt(message, conversationHistory) {
    let prompt = '';

    if (conversationHistory.length > 0) {
      prompt += '**HISTORIQUE** :\n';
      conversationHistory.slice(-3).forEach(msg => {
        prompt += `- ${msg.from}: ${msg.body.substring(0, 80)}...\n`;
      });
      prompt += '\n';
    }

    prompt += `**MESSAGE À ANALYSER** :
De: ${message.from}
Sujet: ${message.subject || '(sans objet)'}

${message.body}

---
Analyse ce message et réponds en JSON.`;

    return prompt;
  }

  /**
   * 📝 User prompt pour génération
   */
  _buildResponseUserPrompt(message, analysis, conversationHistory) {
    let prompt = '';

    if (conversationHistory.length > 0) {
      prompt += '**HISTORIQUE** :\n';
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

**ANALYSE** : ${analysis.intent} (confiance ${(analysis.confidence * 100).toFixed(0)}%)
${analysis.details?.date_souhaitee ? `Date souhaitée: ${analysis.details.date_souhaitee}` : ''}
${analysis.details?.prestation_souhaitee ? `Prestation: ${analysis.details.prestation_souhaitee}` : ''}

Génère une réponse professionnelle (TEXTE SEUL, PAS DE JSON).`;

    return prompt;
  }
}

module.exports = new AIService();
