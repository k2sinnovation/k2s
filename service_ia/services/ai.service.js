// service_ia/services/ai.service.js
// ✅ VERSION UNIFIÉE - Une seule requête Mistral pour Analyse + Génération
// 🔥 Ne répond PAS si le message est non pertinent

const axios = require('axios');
const contextBuilder = require('./context-builder.service');

class AIService {
  /**
   * 🎯 MÉTHODE PRINCIPALE - Analyse + génération en une seule requête
   */
  async analyzeAndGenerateResponse(message, user, conversationHistory = [], driveData = null) {
    const userId = user._id.toString();
    const apiKey = process.env.K2S_IQ;
    if (!apiKey) throw new Error('Clé API Mistral manquante');

    console.log(`[AI:${userId}] 🚀 Analyse + génération unifiée (1 requête)`);

    // 🔹 Charger le contexte Drive
    const driveContext = driveData
      ? this._buildContextFromDriveData(driveData)
      : await this._loadDriveContext(user, true);

    // 🧠 Prompt système
    const systemPrompt = `
${driveContext}

---

TÂCHE:
Tu es un assistant qui gère les emails entrants pour une entreprise.
Tu dois :
1️⃣ Analyser le message du client
2️⃣ Décider s’il est pertinent (RDV, question, annulation, etc.)
3️⃣ Si OUI → Génère une courte réponse professionnelle (3 à 5 phrases)
4️⃣ Si NON → Met "response": null et "is_relevant": false

⚠️ Réponds STRICTEMENT au format JSON suivant (pas de texte avant/après) :

{
  "is_relevant": true/false,
  "confidence": 0.0 à 1.0,
  "intent": "prise_rdv"|"question_info"|"annulation"|"modification"|"reclamation"|"spam"|"autre",
  "reason": "Explication courte",
  "response": "Texte de réponse si pertinent, sinon null"
}

RÈGLES :
- Si non pertinent → response = null
- Si pertinent → réponse naturelle en français, sans markdown, sans HTML
- N'invente jamais d'informations (prix, horaires, etc.)
- Reste professionnel et concis
`;

    // 🧩 Prompt utilisateur
    const userPrompt = `
MESSAGE CLIENT:
De: ${message.from}
Sujet: ${message.subject || '(sans objet)'}
${message.body}

${conversationHistory.length > 0
  ? '\nHISTORIQUE:\n' +
    conversationHistory
      .slice(-3)
      .map(m => `- ${m.from}: ${m.body.substring(0, 80)}...`)
      .join('\n')
  : ''}
`;

    try {
      const response = await axios.post(
        'https://api.mistral.ai/v1/chat/completions',
        {
          model: 'mistral-large-latest',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.5,
          max_tokens: 700
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

      console.log(
        `[AI:${userId}] 📊 Tokens - Prompt: ${usage.prompt_tokens || 0} | Completion: ${usage.completion_tokens || 0} | Total: ${usage.total_tokens || 0}`
      );

      // 🧩 Parsing JSON renvoyé par Mistral
      let result;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        result = JSON.parse(jsonMatch ? jsonMatch[0] : content);
      } catch (err) {
        console.warn(`[AI:${userId}] ⚠️ Erreur parsing JSON`);
        result = {
          is_relevant: false,
          confidence: 0,
          intent: 'error',
          reason: 'JSON invalide',
          response: null
        };
      }

      // 🚫 Si non pertinent → ne rien faire
      if (!result.is_relevant || !result.response) {
        console.log(`[AI:${userId}] ⏭️ Message non pertinent (${result.intent || 'inconnu'})`);
        return {
          analysis: result,
          response: null,
          totalUsage: usage
        };
      }

      // ✅ Si pertinent → réponse prête
      console.log(`[AI:${userId}] ✅ Pertinent: ${result.intent} (${(result.confidence * 100).toFixed(0)}%)`);
      console.log(`[AI:${userId}] ✅ Réponse générée (${result.response.length} chars)`);

      return {
        analysis: result,
        response: result.response,
        totalUsage: usage
      };
    } catch (error) {
      console.error(`[AI:${userId}] ❌ Erreur Mistral:`, error.message);
      return {
        analysis: { is_relevant: false, confidence: 0, intent: 'error', reason: error.message },
        response: null,
        totalUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
    }
  }

  // ==================================================================
  // 🔧 MÉTHODES DE SUPPORT
  // ==================================================================

  async _loadDriveContext(user, includeAppointments = false) {
    const accessToken = user.emailConfig?.accessToken;
    const refreshToken = user.emailConfig?.refreshToken;

    if (!accessToken) return contextBuilder._buildMinimalContext();

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

  _buildContextFromDriveData(driveData) {
    if (!driveData) return '';
    let context = '';

    if (driveData.businessInfo && !driveData.businessInfo._empty) {
      const business = driveData.businessInfo.business || {};
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

      if (driveData.businessInfo.prestations?.length > 0) {
        context += `PRESTATIONS:\n`;
        driveData.businessInfo.prestations.forEach((p, i) => {
          let line = `${i + 1}. ${p.name}`;
          if (p.duration) line += ` (${p.duration} min)`;
          if (p.price) line += ` - ${p.price}€`;
          context += line + '\n';
        });
        context += '\n';
      }

      if (driveData.businessInfo.aiInstructions) {
        context += `INSTRUCTIONS:\n${driveData.businessInfo.aiInstructions}\n\n`;
      }
    }

    if (driveData.planningInfo && !driveData.planningInfo._empty) {
      const planning = driveData.planningInfo;
      if (planning.openingHours && Object.keys(planning.openingHours).length > 0) {
        context += `HORAIRES:\n`;
        const daysMap = {
          monday: 'Lundi',
          tuesday: 'Mardi',
          wednesday: 'Mercredi',
          thursday: 'Jeudi',
          friday: 'Vendredi',
          saturday: 'Samedi',
          sunday: 'Dimanche'
        };
        Object.entries(planning.openingHours).forEach(([day, hours]) => {
          const frenchDay = daysMap[day.toLowerCase()] || day;
          context += `${frenchDay}: ${hours}\n`;
        });
        context += '\n';
      }
    }

    const today = new Date();
    context += `Date: ${today.toLocaleDateString('fr-FR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })}`;

    return context;
  }
}

module.exports = new AIService();
