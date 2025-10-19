const axios = require('axios');
const contextBuilder = require('./context-builder.service');

class AIService {
  constructor() {
    // Stats globales par utilisateur
    this.aiStats = {};
  }

  /**
   * 🎯 MÉTHODE PRINCIPALE SIMPLIFIÉE
   * Analyse PUIS génère (si pertinent)
   */
  async analyzeAndGenerateResponse(message, user, conversationHistory = [], driveData = null) {
    const userId = user._id.toString();
    
    if (!this.aiStats[userId]) {
      this.aiStats[userId] = { totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0 };
    }

    console.log(`[AI:${userId}] 🔍 Étape 1/2 : Analyse du message...`);

    // 1️⃣ ANALYSE
    const { analysis, usage: analysisUsage } = await this.analyzeMessage(message, user, conversationHistory, driveData);
    
    this._updateStats(userId, analysisUsage);

    console.log(`[AI:${userId}] ✅ Analyse: ${analysis.intent} - Pertinent: ${analysis.is_relevant} (${(analysis.confidence*100).toFixed(0)}%)`);
    
    if (!analysis.is_relevant) {
      console.log(`[AI:${userId}] ⏭️ Message non pertinent, pas de réponse`);
      return { analysis, response: null };
    }

    // 2️⃣ GÉNÉRATION DE RÉPONSE
    console.log(`[AI:${userId}] 💬 Étape 2/2 : Génération de la réponse...`);

    const { response, usage: generationUsage } = await this.generateResponse(message, analysis, user, conversationHistory, driveData);

    this._updateStats(userId, generationUsage);

    console.log(`[AI:${userId}] ✅ Réponse générée (${response.length} chars)`);
    console.log(`[AI:${userId}] 🔢 Stats cumulées: Requêtes=${this.aiStats[userId].totalRequests}, Tokens totaux=${this.aiStats[userId].totalTokens}`);

    return { analysis, response };
  }

  /**
   * 🔍 ANALYSE - Retourne JSON simple + usage
   */
  async analyzeMessage(message, user, conversationHistory = [], driveData = null) {
    const apiKey = process.env.K2S_IQ;
    const userId = user._id.toString();
    if (!apiKey) throw new Error('Clé API Mistral manquante');

    let driveContext = driveData ? this._buildContextFromDriveData(driveData) : await this._loadDriveContext(user, false);

    const systemPrompt = this._buildAnalysisSystemPrompt(driveContext);
    const userPrompt = this._buildAnalysisUserPrompt(message, conversationHistory);

    try {
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
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 30000
        }
      );

      const content = response.data.choices[0].message.content.trim();
      const usage = response.data.usage || {};

      let analysis = this._parseAnalysisJSON(content, userId);

      return { analysis, usage };

    } catch (error) {
      console.error(`[AI:${userId}] ❌ Erreur analyse:`, error.message);
      return {
        analysis: { is_relevant: false, confidence: 0.0, intent: 'error', reason: error.message, details: {} },
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
    }
  }

  /**
   * 💬 GÉNÉRATION - Retourne TEXTE pur + usage
   */
  async generateResponse(message, analysis, user, conversationHistory = [], driveData = null) {
    const apiKey = process.env.K2S_IQ;
    const userId = user._id.toString();
    if (!apiKey) throw new Error('Clé API Mistral manquante');

    let driveContext = driveData ? this._buildContextFromDriveData(driveData) : await this._loadDriveContext(user, true);

    const systemPrompt = this._buildResponseSystemPrompt(driveContext, user.aiSettings);
    const userPrompt = this._buildResponseUserPrompt(message, analysis, conversationHistory);

    try {
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
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 30000
        }
      );

      const usage = response.data.usage || {};
      const generatedResponse = response.data.choices[0].message.content.trim();

      return { response: generatedResponse, usage };

    } catch (error) {
      console.error(`[AI:${userId}] ❌ Erreur génération:`, error.message);
      return {
        response: `Bonjour,\n\nMerci pour votre message. Nous avons bien reçu votre demande et reviendrons vers vous rapidement.\n\nCordialement,\n${user.aiSettings.salonName || user.businessName}`,
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
    }
  }

  // ===============================================
  // 🔧 HELPERS
  // ===============================================

  _updateStats(userId, usage) {
    const stats = this.aiStats[userId];
    stats.totalRequests += 1;
    stats.totalPromptTokens += usage.prompt_tokens || 0;
    stats.totalCompletionTokens += usage.completion_tokens || 0;
    stats.totalTokens += usage.total_tokens || 0;
  }

  _parseAnalysisJSON(content, userId) {
    try {
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```json')) cleanContent = cleanContent.replace(/^```json\s*/s, '').replace(/```\s*$/s, '');
      else if (cleanContent.startsWith('```')) cleanContent = cleanContent.replace(/^```\s*/s, '').replace(/```\s*$/s, '');

      const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) cleanContent = jsonMatch[0];

      return JSON.parse(cleanContent);

    } catch (err) {
      console.warn(`[AI:${userId}] ⚠️ Parsing JSON échoué, fallback`);
      return { is_relevant: false, confidence: 0.1, intent: 'error', reason: 'Erreur parsing JSON', details: {} };
    }
  }

  async _loadDriveContext(user, includeAppointments = false) {
    const accessToken = user.emailConfig?.accessToken;
    if (!accessToken) return contextBuilder._buildMinimalContext();
    try {
      return await contextBuilder.buildContextFromDrive(accessToken, user._id.toString(), { includeAppointments });
    } catch (error) {
      console.warn(`[AI:${user._id}] ⚠️ Drive non disponible`, error.message);
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
      if (biz.prices) context += `- Tarifs: ${JSON.stringify(biz.prices)}\n`;
      if (biz.hours) context += `- Horaires: ${JSON.stringify(biz.hours)}\n`;
    }
    if (driveData.planningInfo && !driveData.planningInfo._empty) {
      const planning = driveData.planningInfo;
      context += `\n**DISPONIBILITÉS** :\n`;
      if (planning.availableSlots?.length > 0) context += `- Créneaux dispos: ${planning.availableSlots.slice(0,5).join(', ')}\n`;
    }
    return context;
  }

  // Les méthodes _buildAnalysisSystemPrompt, _buildAnalysisUserPrompt, _buildResponseSystemPrompt, _buildResponseUserPrompt restent identiques à ton code précédent.
}

module.exports = new AIService();
