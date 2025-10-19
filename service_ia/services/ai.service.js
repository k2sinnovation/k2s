const axios = require('axios');
const contextBuilder = require('./context-builder.service');

class AIService {
  constructor() {
    this.totalRequests = 0; // compteur total requêtes Mistral
    this.totalTokens = 0;   // compteur total tokens
  }

  /**
   * 🎯 Méthode principale : analyse puis génère si pertinent
   */
  async analyzeAndGenerateResponse(message, user, conversationHistory = [], driveData = null) {
    const userId = user._id.toString();
    console.log(`[AI:${userId}] 🔍 Étape 1/2 : Analyse du message...`);

    const analysis = await this.analyzeMessage(message, user, conversationHistory, driveData);

    console.log(`[AI:${userId}] ✅ Analyse: ${analysis.intent} - Pertinent: ${analysis.is_relevant} (${(analysis.confidence * 100).toFixed(0)}%)`);
    
    // Si non pertinent, on retourne juste l'analyse et usage
    if (!analysis.is_relevant) {
      console.log(`[AI:${userId}] ⏭️ Message non pertinent, pas de génération`);
      return {
        analysis,
        response: null,
        totalRequests: this.totalRequests,
        totalTokens: this.totalTokens
      };
    }

    // Génération de la réponse
    console.log(`[AI:${userId}] 💬 Étape 2/2 : Génération de la réponse...`);
    const result = await this.generateResponse(message, analysis, user, conversationHistory, driveData);

    console.log(`[AI:${userId}] ✅ Réponse générée (${result.response.length} chars)`);

    // Mettre à jour tokens et requêtes cumulées
    this.totalTokens += (result.usage?.total_tokens || 0);

    return {
      analysis,
      response: result.response,
      totalRequests: this.totalRequests,
      totalTokens: this.totalTokens
    };
  }

  /**
   * 🔍 Analyse : renvoie JSON avec pertinence
   */
  async analyzeMessage(message, user, conversationHistory = [], driveData = null) {
    const userId = user._id.toString();
    const apiKey = process.env.K2S_IQ;
    if (!apiKey) throw new Error('Clé API Mistral manquante');

    const driveContext = driveData
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
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 30000
        }
      );

      const content = response.data.choices[0].message.content.trim();
      const usage = response.data.usage || {};
      this.totalTokens += (usage.total_tokens || 0);

      const analysis = this._parseAnalysisJSON(content, userId);

      return {
        ...analysis,
        usage
      };

    } catch (error) {
      console.error(`[AI:${userId}] ❌ Erreur analyse:`, error.message);
      return {
        is_relevant: false,
        confidence: 0,
        intent: 'error',
        reason: `Erreur IA: ${error.message}`,
        details: {},
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
    }
  }

  /**
   * 💬 Génération de réponse
   */
  async generateResponse(message, analysis, user, conversationHistory = [], driveData = null) {
    const userId = user._id.toString();
    const apiKey = process.env.K2S_IQ;
    if (!apiKey) throw new Error('Clé API Mistral manquante');

    const driveContext = driveData
      ? this._buildContextFromDriveData(driveData)
      : await this._loadDriveContext(user, true);

    const systemPrompt = this._buildResponseSystemPrompt(driveContext);
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
          temperature: user.aiSettings?.temperature || 0.7,
          max_tokens: user.aiSettings?.maxTokens || 500
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 30000
        }
      );

      const generatedResponse = response.data.choices[0].message.content.trim();
      const usage = response.data.usage || {};
      this.totalTokens += (usage.total_tokens || 0);

      return { response: generatedResponse, usage };

    } catch (error) {
      console.error(`[AI:${userId}] ❌ Erreur génération:`, error.message);
      return { response: 'Bonjour,\nMerci pour votre message. Nous vous répondrons bientôt.\nCordialement.', usage: { total_tokens: 0 } };
    }
  }

  /**
   * 🔨 Parsing JSON robuste avec extraction manuelle si besoin
   */
  _parseAnalysisJSON(content, userId) {
    try {
      let clean = content.trim();
      if (clean.startsWith('```json')) clean = clean.replace(/^```json\s*/s, '').replace(/```\s*$/s, '');
      else if (clean.startsWith('```')) clean = clean.replace(/^```\s*/s, '').replace(/```\s*$/s, '');

      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (jsonMatch) clean = jsonMatch[0];

      return JSON.parse(clean);
    } catch (err) {
      console.warn(`[AI:${userId}] ⚠️ Parsing JSON échoué, extraction manuelle...`);
      const isRelevantMatch = content.match(/"is_relevant"\s*:\s*(true|false)/i);
      const intentMatch = content.match(/"intent"\s*:\s*"([^"]+)"/i);
      const confidenceMatch = content.match(/"confidence"\s*:\s*([0-9.]+)/);
      return {
        is_relevant: isRelevantMatch ? isRelevantMatch[1] === 'true' : false,
        intent: intentMatch ? intentMatch[1] : 'unknown',
        confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5,
        reason: 'Parsing manuel',
        details: {}
      };
    }
  }

  /**
   * 🔨 Contexte Drive
   */
  async _loadDriveContext(user, includeAppointments = false) {
    const accessToken = user.emailConfig?.accessToken;
    if (!accessToken) return contextBuilder._buildMinimalContext();
    try {
      return await contextBuilder.buildContextFromDrive(accessToken, user._id.toString(), { includeAppointments });
    } catch (err) {
      console.warn(`[AI:${user._id}] ⚠️ Drive non disponible:`, err.message);
      return contextBuilder._buildMinimalContext();
    }
  }

  _buildContextFromDriveData(driveData) {
    if (!driveData) return '';
    let context = '';
    if (driveData.businessInfo) context += `Entreprise: ${driveData.businessInfo.name || 'N/A'}\n`;
    if (driveData.planningInfo?.availableSlots) context += `Slots: ${driveData.planningInfo.availableSlots.join(', ')}\n`;
    return context;
  }

  _buildAnalysisSystemPrompt(driveContext) {
    return `${driveContext}\n---\nAnalyse le message client et renvoie JSON {is_relevant,intent,confidence,reason,details}`;
  }

  _buildAnalysisUserPrompt(message, conversationHistory) {
    let prompt = '';
    if (conversationHistory.length) {
      prompt += 'Historique:\n';
      conversationHistory.slice(-3).forEach(m => prompt += `- ${m.from}: ${m.body.substring(0,80)}...\n`);
      prompt += '\n';
    }
    prompt += `Message à analyser:\nDe: ${message.from}\nSujet: ${message.subject || '(sans objet)'}\n${message.body}`;
    return prompt;
  }

  _buildResponseSystemPrompt(driveContext) {
    return `${driveContext}\n---\nGénère une réponse professionnelle au client en texte naturel. Pas de JSON.`;
  }

  _buildResponseUserPrompt(message, analysis, conversationHistory) {
    let prompt = '';
    if (conversationHistory.length) {
      prompt += 'Historique:\n';
      conversationHistory.slice(-3).forEach(m => prompt += `- ${m.from}: ${m.body.substring(0,80)}...\n`);
      prompt += '\n';
    }
    prompt += `Message client:\nDe: ${message.from}\nSujet: ${message.subject || '(sans objet)'}\n${message.body}\n---\nAnalyse: ${analysis.intent} (${(analysis.confidence*100).toFixed(0)}%)`;
    return prompt;
  }
}

module.exports = new AIService();
