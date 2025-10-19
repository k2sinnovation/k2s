// ============================================================
// ✅ VERSION ROBUSTE - Analyse + Génération séparées
// Tolère les JSON mal formés et corrige les erreurs de parsing
// ============================================================

const axios = require('axios');
const contextBuilder = require('./context-builder.service');

class AIService {
  
  /**
   * 🎯 MÉTHODE PRINCIPALE : Analyse PUIS Génération (si pertinent)
   */
  async analyzeAndGenerateResponse(message, user, conversationHistory = [], driveData = null) {
    const userId = user._id.toString();
    console.log(`[AI:${userId}] 🔍 Étape 1/2 : Analyse du message...`);

    // 1️⃣ ANALYSE DU MESSAGE
    const analysis = await this.analyzeMessage(message, user, conversationHistory, driveData);

    console.log(`[AI:${userId}] ✅ Analyse: ${analysis.intent} - Pertinent: ${analysis.is_relevant} (${(analysis.confidence * 100).toFixed(0)}%)`);

    // 2️⃣ Si non pertinent → stop
    if (!analysis.is_relevant) {
      console.log(`[AI:${userId}] ⏭️ Message non pertinent, pas de réponse`);
      return { analysis, response: null };
    }

    // 3️⃣ GÉNÉRATION DE RÉPONSE
    console.log(`[AI:${userId}] 💬 Étape 2/2 : Génération de la réponse...`);

    const response = await this.generateResponse(message, analysis, user, conversationHistory, driveData);

    console.log(`[AI:${userId}] ✅ Réponse générée (${response.length} chars)`);

    return { analysis, response };
  }

  // ============================================================
  // 🧩 1. ANALYSE DU MESSAGE
  // ============================================================
  async analyzeMessage(message, user, conversationHistory = [], driveData = null) {
    const apiKey = process.env.K2S_IQ;
    const userId = user._id.toString();

    if (!apiKey) throw new Error('Clé API Mistral manquante (K2S_IQ)');

    // Charger contexte Drive
    let driveContext = '';
    if (driveData) {
      driveContext = this._buildContextFromDriveData(driveData);
    } else {
      driveContext = await this._loadDriveContext(user, false);
    }

    const systemPrompt = this._buildAnalysisSystemPrompt(driveContext);
    const userPrompt = this._buildAnalysisUserPrompt(message, conversationHistory);

    try {
      const mistralModel = this._getMistralModel(user.aiSettings?.aiModel);
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
      const analysis = this._parseAnalysisJSON(content, userId);

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

  // ============================================================
  // 🧩 2. GÉNÉRATION DE LA RÉPONSE
  // ============================================================
  async generateResponse(message, analysis, user, conversationHistory = [], driveData = null) {
    const apiKey = process.env.K2S_IQ;
    const userId = user._id.toString();

    if (!apiKey) throw new Error('Clé API Mistral manquante (K2S_IQ)');

    // Charger contexte Drive avec disponibilités
    let driveContext = '';
    if (driveData) {
      driveContext = this._buildContextFromDriveData(driveData);
    } else {
      driveContext = await this._loadDriveContext(user, true);
    }

    const systemPrompt = this._buildResponseSystemPrompt(driveContext, user.aiSettings || {});
    const userPrompt = this._buildResponseUserPrompt(message, analysis, conversationHistory);

    try {
      const mistralModel = this._getMistralModel(user.aiSettings?.aiModel);
      console.log(`[AI:${userId}] 📡 Appel Mistral Génération: ${mistralModel}`);

      const response = await axios.post(
        'https://api.mistral.ai/v1/chat/completions',
        {
          model: mistralModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7,
          max_tokens: 500
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
      return `Bonjour,\n\nMerci pour votre message. Nous avons bien reçu votre demande et nous vous répondrons dans les plus brefs délais.\n\nCordialement,\n${user.aiSettings?.salonName || user.businessName}`;
    }
  }

  // ============================================================
  // 🔧 HELPER : Parsing JSON robuste
  // ============================================================
  _parseAnalysisJSON(content, userId) {
    try {
      let clean = content.trim();
      clean = clean.replace(/^```[a-z]*\s*/i, '').replace(/```$/i, '').trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) clean = match[0];

      clean = clean
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']')
        .replace(/“|”/g, '"')
        .replace(/[\u0000-\u001F]+/g, '');

      const parsed = JSON.parse(clean);
      if (typeof parsed.is_relevant !== 'boolean') throw new Error('Champ manquant');
      return parsed;
    } catch (error) {
      console.warn(`[AI:${userId}] ⚠️ JSON mal formé, extraction partielle...`);

      const isRelevant = /"is_relevant"\s*:\s*(true|false)/i.exec(content);
      const intent = /"intent"\s*:\s*"([^"]+)"/i.exec(content);
      const confidence = /"confidence"\s*:\s*([0-9.]+)/i.exec(content);
      const reason = /"reason"\s*:\s*"([^"]+)"/i.exec(content);

      return {
        is_relevant: isRelevant ? isRelevant[1] === 'true' : false,
        confidence: confidence ? parseFloat(confidence[1]) : 0.5,
        intent: intent ? intent[1] : 'unknown',
        reason: reason ? reason[1] : 'fallback parsing',
        details: {}
      };
    }
  }

  // ============================================================
  // 🔧 HELPER : Prompts
  // ============================================================
  _buildAnalysisSystemPrompt(driveContext) {
    return `${driveContext}

---

Tu es un expert en analyse de messages clients.

**TÂCHE** : Analyse ce message et détermine s'il est pertinent.

**CRITÈRES** :
- ✅ Pertinent : prise de rendez-vous, questions prestations/tarifs/horaires, annulation, modification
- ❌ Non pertinent : spam, pub, notification, newsletter, message vide

**RÉPONDS EN JSON STRICTEMENT VALIDE (PAS DE MARKDOWN, PAS DE TEXTE AUTOUR)** :
Commence par { et termine par }.

FORMAT :
{
  "is_relevant": true ou false,
  "confidence": 0.0 à 1.0,
  "intent": "prise_rdv"|"question_info"|"annulation"|"modification"|"reclamation"|"spam"|"autre",
  "reason": "explication courte",
  "details": {
    "date_souhaitee": "si mentionnée ou null",
    "prestation_souhaitee": "si mentionnée ou null"
  }
}`;
  }

  _buildAnalysisUserPrompt(message, conversationHistory) {
    let prompt = '';
    if (conversationHistory.length > 0) {
      prompt += '**HISTORIQUE** :\n';
      conversationHistory.slice(-3).forEach(m => {
        prompt += `- ${m.from}: ${m.body.substring(0, 80)}...\n`;
      });
      prompt += '\n';
    }

    prompt += `**MESSAGE À ANALYSER** :
De: ${message.from}
Sujet: ${message.subject || '(sans objet)'}

${message.body}

---
Analyse et réponds en JSON.`;
    return prompt;
  }

  _buildResponseSystemPrompt(driveContext, settings) {
    const tone = settings.tone || 'professionnel';
    return `${driveContext}

---

Tu es ${settings.role || 'un assistant virtuel'} pour ${settings.salonName || 'cette entreprise'}.

INSTRUCTIONS :
${settings.instructions || 'Sois professionnel et courtois.'}

TON : ${tone}

RÈGLES :
1. Réponds en français naturel
2. 3 à 5 phrases maximum
3. Utilise les infos du contexte Drive
4. Propose des créneaux si pertinent
5. Ne fais AUCUN JSON ni explication, uniquement le texte de l'email`;
  }

  _buildResponseUserPrompt(message, analysis, conversationHistory) {
    let prompt = '';
    if (conversationHistory.length > 0) {
      prompt += '**HISTORIQUE** :\n';
      conversationHistory.slice(-3).forEach(m => {
        prompt += `- ${m.from}: ${m.body.substring(0, 80)}...\n`;
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

Génère une réponse professionnelle en texte pur.`;
    return prompt;
  }

  // ============================================================
  // 🔧 HELPER : Drive / Modèle
  // ============================================================
  async _loadDriveContext(user, includeAppointments = false) {
    const accessToken = user.emailConfig?.accessToken;
    if (!accessToken) return contextBuilder._buildMinimalContext();

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

  _buildContextFromDriveData(driveData) {
    if (!driveData) return '';
    let context = '**INFORMATIONS ENTREPRISE** :\n';
    if (driveData.businessInfo && !driveData.businessInfo._empty) {
      const biz = driveData.businessInfo;
      context += `- Nom: ${biz.name || 'N/A'}\n`;
      context += `- Description: ${biz.description || 'N/A'}\n`;
      if (biz.services?.length > 0) context += `- Services: ${biz.services.join(', ')}\n`;
    }
    if (driveData.planningInfo && !driveData.planningInfo._empty) {
      const planning = driveData.planningInfo;
      if (planning.availableSlots?.length > 0) {
        context += `\n**DISPONIBILITÉS** :\n${planning.availableSlots.slice(0, 5).join(', ')}\n`;
      }
    }
    return context;
  }

  _getMistralModel(userModel) {
    const map = {
      'gpt-4': 'mistral-large-latest',
      'gpt-4o': 'mistral-large-latest',
      'gpt-4o-mini': 'mistral-small-latest',
      'gpt-3.5-turbo': 'mistral-small-latest'
    };
    if (userModel && userModel.startsWith('mistral-')) return userModel;
    return map[userModel] || 'mistral-small-latest';
  }
}

module.exports = new AIService();
