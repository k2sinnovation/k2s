// service_ia/services/ai.service.js
// ✅ VERSION SIMPLIFIÉE - Texte naturel sans markdown

const axios = require('axios');
const contextBuilder = require('./context-builder.service');

class AIService {
  
  /**
   * 🎯 MÉTHODE PRINCIPALE
   * Analyse PUIS génère (si pertinent)
   */
  async analyzeAndGenerateResponse(message, user, conversationHistory = [], driveData = null) {
    const userId = user._id.toString();
    
    console.log(`[AI:${userId}] 🔍 Étape 1/2 : Analyse du message...`);
    
    // 1️⃣ ANALYSE
    const analysis = await this.analyzeMessage(message, user, conversationHistory, driveData);
    
    console.log(`[AI:${userId}] ✅ Analyse: ${analysis.intent} - Pertinent: ${analysis.is_relevant} (${(analysis.confidence * 100).toFixed(0)}%)`);
    
    // 2️⃣ Si non pertinent, on s'arrête
    if (!analysis.is_relevant) {
      console.log(`[AI:${userId}] ⏭️ Message non pertinent, pas de réponse`);
      return { analysis, response: null };
    }
    
    // 3️⃣ GÉNÉRATION
    console.log(`[AI:${userId}] 💬 Étape 2/2 : Génération de la réponse...`);
    const response = await this.generateResponse(message, analysis, user, conversationHistory, driveData);
    
    console.log(`[AI:${userId}] ✅ Réponse générée (${response.length} chars)`);
    
    return { analysis, response };
  }

  /**
   * 🔍 ANALYSE - Retourne JSON simple
   */
  async analyzeMessage(message, user, conversationHistory = [], driveData = null) {
    const settings = user.aiSettings;
    const apiKey = process.env.K2S_IQ;
    const userId = user._id.toString();
    
    if (!apiKey) throw new Error('Clé API Mistral manquante');

    const driveContext = driveData 
      ? this._buildContextFromDriveData(driveData)
      : await this._loadDriveContext(user, false);

    const systemPrompt = this._buildAnalysisSystemPrompt(driveContext);
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
   * 💬 GÉNÉRATION - Retourne TEXTE pur
   */
  async generateResponse(message, analysis, user, conversationHistory = [], driveData = null) {
    const settings = user.aiSettings;
    const apiKey = process.env.K2S_IQ;
    const userId = user._id.toString();
    
    if (!apiKey) throw new Error('Clé API Mistral manquante');

    const driveContext = driveData
      ? this._buildContextFromDriveData(driveData)
      : await this._loadDriveContext(user, true);

    const systemPrompt = this._buildResponseSystemPrompt(driveContext);
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

      return response.data.choices[0].message.content.trim();

    } catch (error) {
      console.error(`[AI:${userId}] ❌ Erreur génération:`, error.message);
      
      if (error.response?.status === 429) {
        console.warn(`[AI:${userId}] ⚠️ Rate limit Mistral atteint`);
      }
      
      return `Bonjour,\n\nMerci pour votre message. Nous avons bien reçu votre demande et nous vous répondrons dans les plus brefs délais.\n\nCordialement,\nL'équipe`;
    }
  }

  /**
   * 🔨 Parser JSON d'analyse
   */
  _parseAnalysisJSON(content, userId) {
    try {
      let cleanContent = content.trim();
      
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.replace(/^```json\s*/s, '').replace(/```\s*$/s, '');
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```\s*/s, '').replace(/```\s*$/s, '');
      }
      
      const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) cleanContent = jsonMatch[0];
      
      return JSON.parse(cleanContent);
      
    } catch (error) {
      console.warn(`[AI:${userId}] ⚠️ Parsing JSON échoué, extraction manuelle...`);
      
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
   * 🔨 Charger contexte Drive
   */
  async _loadDriveContext(user, includeAppointments = false) {
    const accessToken = user.emailConfig?.accessToken;
    const refreshToken = user.emailConfig?.refreshToken;
    
    if (!accessToken) {
      return contextBuilder._buildMinimalContext();
    }
    
    try {
      const context = await contextBuilder.buildContextFromDrive(
        accessToken,
        user._id.toString(),
        { includeAppointments, refreshToken }
      );
      console.log(`[AI:${user._id}] ✅ Contexte Drive chargé (${context.length} chars)`);
      return context;
    } catch (error) {
      console.warn(`[AI:${user._id}] ⚠️ Drive non disponible:`, error.message);
      return contextBuilder._buildMinimalContext();
    }
  }

  /**
   * 🔨 Construire contexte depuis driveData
   */
  _buildContextFromDriveData(driveData) {
    if (!driveData) return '';
    
    let context = '';
    
    if (driveData.businessInfo && !driveData.businessInfo._empty) {
      const businessInfo = driveData.businessInfo;
      const business = businessInfo.business || {};
      
      const businessName = business.name || 'cette entreprise';
      context += `Tu es l'assistant virtuel de ${businessName}. Tu aides les clients à prendre rendez-vous.\n\n`;
      
      if (business.name || business.description) {
        context += `ENTREPRISE:\n`;
        if (business.name) context += `Nom: ${business.name}\n`;
        if (business.description) context += `Description: ${business.description}\n`;
        if (business.address) context += `Adresse: ${business.address}\n`;
        if (business.phone) context += `Téléphone: ${business.phone}\n`;
        context += '\n';
      }
      
      if (businessInfo.prestations && businessInfo.prestations.length > 0) {
        context += `PRESTATIONS:\n`;
        businessInfo.prestations.forEach((p, i) => {
          let line = `${i + 1}. ${p.name}`;
          if (p.duration) line += ` (${p.duration} min)`;
          if (p.price) line += ` - ${p.price}€`;
          context += line + '\n';
        });
        context += '\n';
      }
      
      if (businessInfo.aiInstructions) {
        context += `INSTRUCTIONS:\n${businessInfo.aiInstructions}\n\n`;
      }
    }
    
    if (driveData.planningInfo && !driveData.planningInfo._empty) {
      const planning = driveData.planningInfo;
      
      if (planning.openingHours && Object.keys(planning.openingHours).length > 0) {
        context += `HORAIRES:\n`;
        const daysMap = {
          'monday': 'Lundi', 'tuesday': 'Mardi', 'wednesday': 'Mercredi',
          'thursday': 'Jeudi', 'friday': 'Vendredi', 'saturday': 'Samedi', 'sunday': 'Dimanche'
        };
        
        Object.entries(planning.openingHours).forEach(([day, hours]) => {
          const frenchDay = daysMap[day.toLowerCase()] || day;
          context += `${frenchDay}: ${hours}\n`;
        });
        context += '\n';
      }
    }
    
    const today = new Date();
    context += `Date: ${today.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`;
    
    return context;
  }

  /**
   * 🔨 Mapper modèles Mistral
   */
  _getMistralModel(userModel) {
    const modelMapping = {
      'gpt-4': 'mistral-large-latest',
      'gpt-4o': 'mistral-large-latest',
      'gpt-4o-mini': 'mistral-small-latest',
      'gpt-3.5-turbo': 'mistral-small-latest'
    };

    if (userModel && userModel.startsWith('mistral-')) return userModel;
    return modelMapping[userModel] || 'mistral-small-latest';
  }

  /**
   * 📝 PROMPT : Analyse
   */
  _buildAnalysisSystemPrompt(driveContext) {
    return `${driveContext}

---

TÂCHE: Analyse le message et détermine s'il est pertinent.

CRITÈRES:
- Pertinent: RDV, questions sur services/tarifs/horaires, annulation, modification
- Non pertinent: spam, pub, newsletter, notifications auto

RÉPONDS EN JSON UNIQUEMENT:
{
  "is_relevant": true/false,
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
   * 📝 PROMPT : Génération - TEXTE NATUREL
   */
  _buildResponseSystemPrompt(driveContext) {
    return `${driveContext}

---

TÂCHE: Génère une réponse professionnelle au client en texte naturel.

RÈGLES ABSOLUES:
1. Réponds en français conversationnel
2. Sois concis (3-5 phrases max)
3. Utilise UNIQUEMENT les informations du contexte ci-dessus

INTERDICTIONS:
❌ Pas de markdown: pas de **, pas de -, pas de #
❌ N'invente JAMAIS d'horaires, prix ou infos absentes du contexte
❌ Pas de JSON, pas d'explications, juste le texte de l'email

IMPORTANT: Réponds UNIQUEMENT avec le texte brut de l'email à envoyer.`;
  }

  /**
   * 📝 User prompt pour analyse
   */
  _buildAnalysisUserPrompt(message, conversationHistory) {
    let prompt = '';

    if (conversationHistory.length > 0) {
      prompt += 'HISTORIQUE:\n';
      conversationHistory.slice(-3).forEach(msg => {
        prompt += `- ${msg.from}: ${msg.body.substring(0, 80)}...\n`;
      });
      prompt += '\n';
    }

    prompt += `MESSAGE À ANALYSER:
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
      prompt += 'HISTORIQUE:\n';
      conversationHistory.slice(-3).forEach(msg => {
        prompt += `- ${msg.from}: ${msg.body.substring(0, 80)}...\n`;
      });
      prompt += '\n';
    }

    prompt += `MESSAGE CLIENT:
De: ${message.from}
Sujet: ${message.subject || '(sans objet)'}

${message.body}

---

ANALYSE: ${analysis.intent} (${(analysis.confidence * 100).toFixed(0)}% confiance)
${analysis.details?.date_souhaitee ? `Date souhaitée: ${analysis.details.date_souhaitee}` : ''}
${analysis.details?.prestation_souhaitee ? `Prestation: ${analysis.details.prestation_souhaitee}` : ''}

Génère une réponse en texte naturel (pas de markdown, pas de JSON).`;

    return prompt;
  }
}

module.exports = new AIService();
