const axios = require('axios');
const contextBuilder = require('./context-builder.service');

class AIService {
  constructor() {
    this.totalRequests = 0; // compteur total de requêtes IA
    this.totalTokens = 0;   // compteur total de tokens utilisés
  }

  /**
   * 🎯 MÉTHODE PRINCIPALE SIMPLIFIÉE
   * Analyse PUIS génère (si pertinent)
   */
  async analyzeAndGenerateResponse(message, user, conversationHistory = [], driveData = null) {
    const userId = user._id.toString();

    console.log(`[AI:${userId}] 🔍 Étape 1/2 : Analyse du message...`);

    // 1️⃣ ANALYSE
    const analysisResult = await this.analyzeMessage(message, user, conversationHistory, driveData);

    console.log(`[AI:${userId}] ✅ Analyse: ${analysisResult.intent} - Pertinent: ${analysisResult.is_relevant} (${(analysisResult.confidence * 100).toFixed(0)}%)`);
    
    // 2️⃣ Si non pertinent, on s'arrête là
    if (!analysisResult.is_relevant) {
      console.log(`[AI:${userId}] ⏭️ Message non pertinent, pas de réponse`);
      return {
        analysis: analysisResult,
        response: null,
        totalRequests: this.totalRequests,
        totalTokens: this.totalTokens
      };
    }

    // 3️⃣ GÉNÉRATION DE RÉPONSE (TEXTE PUR)
    console.log(`[AI:${userId}] 💬 Étape 2/2 : Génération de la réponse...`);
    const response = await this.generateResponse(message, analysisResult, user, conversationHistory, driveData);

    console.log(`[AI:${userId}] ✅ Réponse générée (${response.length} chars)`);

    return {
      analysis: analysisResult,
      response,
      totalRequests: this.totalRequests,
      totalTokens: this.totalTokens
    };
  }

  /**
   * 🔍 ANALYSE - Retourne JSON simple
   */
  async analyzeMessage(message, user, conversationHistory = [], driveData = null) {
    const apiKey = process.env.K2S_IQ;
    const userId = user._id.toString();
    if (!apiKey) throw new Error('Clé API Mistral manquante');

    let driveContext = driveData
      ? this._buildContextFromDriveData(driveData)
      : await this._loadDriveContext(user, false);

    const systemPrompt = this._buildAnalysisSystemPrompt(driveContext);
    const userPrompt = this._buildAnalysisUserPrompt(message, conversationHistory);

    try {
      this.totalRequests += 1;
      const response = await axios.post(
        'https://api.mistral.ai/v1/chat/completions',
        {
          model: 'mistral-large-latest',
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
      const usage = response.data.usage || {};
      this.totalTokens += (usage.total_tokens || 0);

      return this._parseAnalysisJSON(content, userId);

    } catch (error) {
      console.error(`[AI:${userId}] ❌ Erreur analyse:`, error.message);
      return {
        is_relevant: false,
        confidence: 0,
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
    const apiKey = process.env.K2S_IQ;
    const userId = user._id.toString();
    if (!apiKey) throw new Error('Clé API Mistral manquante');

    let driveContext = driveData
      ? this._buildContextFromDriveData(driveData)
      : await this._loadDriveContext(user, true);

    const systemPrompt = this._buildResponseSystemPrompt(driveContext, user.aiSettings);
    const userPrompt = this._buildResponseUserPrompt(message, analysis, conversationHistory);

    try {
      this.totalRequests += 1;
      const response = await axios.post(
        'https://api.mistral.ai/v1/chat/completions',
        {
          model: 'mistral-large-latest',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: user.aiSettings.temperature || 0.7,
          max_tokens: user.aiSettings.maxTokens || 500
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      const usage = response.data.usage || {};
      this.totalTokens += (usage.total_tokens || 0);

      return response.data.choices[0].message.content.trim();
    } catch (error) {
      console.error(`[AI:${userId}] ❌ Erreur génération:`, error.message);
      return `Bonjour,\n\nMerci pour votre message. Nous avons bien reçu votre demande et nous vous répondrons dans les plus brefs délais.\n\nCordialement,\n${user.aiSettings.salonName || user.businessName}`;
    }
  }

  // ==================================================================
  // 🔧 HELPERS
  // ==================================================================
  _parseAnalysisJSON(content, userId) {
    try {
      let clean = content.trim();
      if (clean.startsWith('```json')) clean = clean.replace(/^```json\s*/s, '').replace(/```\s*$/s, '');
      if (clean.startsWith('```')) clean = clean.replace(/^```\s*/s, '').replace(/```\s*$/s, '');

      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (jsonMatch) clean = jsonMatch[0];

      return JSON.parse(clean);
    } catch (err) {
      console.warn(`[AI:${userId}] ⚠️ Parsing JSON échoué`);
      return { is_relevant: false, confidence: 0, intent: 'error', reason: 'JSON invalide', details: {} };
    }
  }

  async _loadDriveContext(user, includeAppointments = false) {
    const accessToken = user.emailConfig?.accessToken;
    if (!accessToken) return contextBuilder._buildMinimalContext();
    try {
      const ctx = await contextBuilder.buildContextFromDrive(accessToken, user._id.toString(), { includeAppointments });
      return ctx;
    } catch (err) {
      console.warn(`[AI:${user._id}] ⚠️ Drive non disponible:`, err.message);
      return contextBuilder._buildMinimalContext();
    }
  }

  _buildContextFromDriveData(driveData) {
    if (!driveData) return '';
    let context = '**INFORMATIONS ENTREPRISE** :\n';
    if (driveData.businessInfo && !driveData.businessInfo._empty) {
      const biz = driveData.businessInfo;
      context += `- Nom: ${biz.name || 'N/A'}\n`;
      context += `- Description: ${biz.description || 'N/A'}\n`;
      if (biz.services?.length) context += `- Services: ${biz.services.join(', ')}\n`;
      if (biz.prices) context += `- Tarifs: ${JSON.stringify(biz.prices)}\n`;
      if (biz.hours) context += `- Horaires: ${JSON.stringify(biz.hours)}\n`;
    }
    if (driveData.planningInfo && !driveData.planningInfo._empty) {
      const planning = driveData.planningInfo;
      if (planning.availableSlots?.length) context += `- Créneaux dispo: ${planning.availableSlots.join(', ')}\n`;
    }
    return context;
  }

  // ==================================================================
  // 🔨 PROMPTS
  // ==================================================================
  _buildAnalysisSystemPrompt(driveContext) {
    return `${driveContext}

---

Tu es un expert en analyse de messages clients.

**TÂCHE** : Analyse ce message et détermine s'il est pertinent.

**CRITÈRES** :
- ✅ Pertinent : RDV, questions prestations/tarifs/horaires, annulation, modification
- ❌ Non pertinent : spam, pub, newsletter, notification auto

**RÉPONDS EN JSON UNIQUEMENT** :
{
  "is_relevant": true ou false,
  "confidence": 0.0 à 1.0,
  "intent": "prise_rdv"|"question_info"|"annulation"|"modification"|"reclamation"|"spam"|"autre",
  "reason": "Explication courte",
  "details": {
    "date_souhaitee": null,
    "prestation_souhaitee": null
  }
}`;
  }

  _buildAnalysisUserPrompt(message, conversationHistory) {
    let prompt = '';
    if (conversationHistory.length) {
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
2. Sois concis (3-5 phrases max)
3. Utilise les infos du contexte Drive
4. Propose des créneaux concrets si pertinent
5. Termine par une formule de politesse
6. N'invente JAMAIS d'informations non présentes

**IMPORTANT** : Réponds UNIQUEMENT avec le texte de l'email, AUCUN JSON, AUCUNE explication.`;
  }

  _buildResponseUserPrompt(message, analysis, conversationHistory) {
    let prompt = '';
    if (conversationHistory.length) {
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
