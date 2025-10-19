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

    const systemPrompt = this._buildAnalysisSystemPrompt(driveContext);
    const userPrompt = this._buildAnalysisUserPrompt(message, conversationHistory);

    // 🔍 DEBUG TEMPORAIRE
    console.log(`[AI:${userId}] 📄 CONTEXTE ENVOYÉ À MISTRAL (${driveContext.length} chars):`);
    console.log('='.repeat(80));
    console.log(driveContext.substring(0, 1000)); // Premiers 1000 chars
    console.log('...');
    console.log('='.repeat(80));

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

    const systemPrompt = this._buildResponseSystemPrompt(driveContext);
    const userPrompt = this._buildResponseUserPrompt(message, analysis, conversationHistory);

    // 🔍 DEBUG TEMPORAIRE
    console.log(`[AI:${userId}] 📄 CONTEXTE POUR GÉNÉRATION (${driveContext.length} chars):`);
    console.log('='.repeat(80));
    console.log(driveContext.substring(0, 1000)); // Premiers 1000 chars
    console.log('...');
    console.log('='.repeat(80));

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
      
      // Gestion spéciale du rate limit (429)
      if (error.response?.status === 429) {
        console.warn(`[AI:${userId}] ⚠️ Rate limit Mistral atteint, utilisation du fallback`);
      }
      
      // Fallback générique
      return `Bonjour,\n\nMerci pour votre message. Nous avons bien reçu votre demande et nous vous répondrons dans les plus brefs délais.\n\nCordialement,\nL'équipe`;
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
    const refreshToken = user.emailConfig?.refreshToken; // ✅ AJOUT
    
    if (!accessToken) {
      return contextBuilder._buildMinimalContext();
    }
    
    try {
      const context = await contextBuilder.buildContextFromDrive(
        accessToken,
        user._id.toString(),
        { 
          includeAppointments,
          refreshToken  // ✅ AJOUT
        }
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
    
    let context = '';
    
    // ✅ CORRECTION : Accéder correctement à la structure
    if (driveData.businessInfo && !driveData.businessInfo._empty) {
      const businessInfo = driveData.businessInfo;
      const business = businessInfo.business || {};
      
      // En-tête
      const businessName = business.name || 'cette entreprise';
      context += `# CONTEXTE ENTREPRISE\n\n`;
      context += `Tu es un assistant virtuel intelligent pour ${businessName}.\n`;
      context += `Ton rôle est d'aider les clients à prendre rendez-vous et répondre à leurs questions.\n\n`;
      
      // Informations business
      if (business.name || business.activity || business.description) {
        context += `## INFORMATIONS ENTREPRISE\n`;
        if (business.name) context += `- Nom: ${business.name}\n`;
        if (business.activity) context += `- Activité: ${business.activity}\n`;
        if (business.description) context += `- Description: ${business.description}\n`;
        if (business.address) context += `- Adresse: ${business.address}\n`;
        if (business.phone) context += `- Téléphone: ${business.phone}\n`;
        context += '\n';
      }
      
      // Prestations
      if (businessInfo.prestations && businessInfo.prestations.length > 0) {
        context += `## PRESTATIONS DISPONIBLES\n`;
        businessInfo.prestations.forEach((p, index) => {
          let line = `${index + 1}. **${p.name}**`;
          if (p.duration) line += ` - ${p.duration} minutes`;
          if (p.price) line += ` - ${p.price}€`;
          if (p.description) line += `\n   ${p.description}`;
          context += line + '\n';
        });
        context += '\n';
      }
      
      // Équipe
      if (businessInfo.team && businessInfo.team.length > 0) {
        context += `## ÉQUIPE\n`;
        businessInfo.team.forEach((member, index) => {
          let line = `${index + 1}. **${member.name}**`;
          if (member.role) line += ` - ${member.role}`;
          if (member.specialties) line += ` (${member.specialties})`;
          context += line + '\n';
        });
        context += '\n';
      }
      
      // Instructions IA personnalisées
      if (businessInfo.aiInstructions) {
        context += `## INSTRUCTIONS SPÉCIFIQUES\n\n${businessInfo.aiInstructions}\n\n`;
      }
    }
    
    // Planning
    if (driveData.planningInfo && !driveData.planningInfo._empty) {
      const planning = driveData.planningInfo;
      
      // Horaires d'ouverture
      if (planning.openingHours && Object.keys(planning.openingHours).length > 0) {
        context += `## HORAIRES D'OUVERTURE\n`;
        const daysMap = {
          'monday': 'Lundi', 'tuesday': 'Mardi', 'wednesday': 'Mercredi',
          'thursday': 'Jeudi', 'friday': 'Vendredi', 'saturday': 'Samedi', 'sunday': 'Dimanche',
          'lundi': 'Lundi', 'mardi': 'Mardi', 'mercredi': 'Mercredi',
          'jeudi': 'Jeudi', 'vendredi': 'Vendredi', 'samedi': 'Samedi', 'dimanche': 'Dimanche'
        };
        
        Object.entries(planning.openingHours).forEach(([day, hours]) => {
          const frenchDay = daysMap[day.toLowerCase()] || day;
          context += `- **${frenchDay}**: ${hours}\n`;
        });
        context += '\n';
      }
      
      // Jours fermés
      if (planning.closedDates && planning.closedDates.length > 0) {
        context += `## FERMETURES EXCEPTIONNELLES\n`;
        planning.closedDates.forEach(date => {
          context += `- ${date}\n`;
        });
        context += '\n';
      }
      
      // Rendez-vous
      if (planning.appointments && planning.appointments.length > 0) {
        context += `## RENDEZ-VOUS À VENIR\n`;
        const upcoming = planning.appointments
          .filter(apt => new Date(apt.date) >= new Date())
          .sort((a, b) => new Date(a.date) - new Date(b.date))
          .slice(0, 5);
        
        upcoming.forEach(apt => {
          context += `- ${apt.date} à ${apt.time}: ${apt.service} avec ${apt.client}\n`;
        });
        context += '\n';
      }
    }
    
    // Pied de page avec règles
    if (context.length > 0) {
      context += `## RÈGLES GÉNÉRALES\n\n`;
      context += `1. **Sois professionnel et courtois** dans toutes tes réponses\n`;
      context += `2. **Vérifie les disponibilités** avant de proposer un créneau\n`;
      context += `3. **Pose des questions** si tu as besoin de plus d'informations\n`;
      context += `4. **Confirme toujours** les détails du rendez-vous (date, heure, prestation)\n`;
      context += `5. **Propose des alternatives** si le créneau demandé n'est pas disponible\n`;
      context += `6. **Reste dans ton rôle** : tu ne peux que gérer les rendez-vous et répondre aux questions sur l'entreprise\n\n`;
      
      const today = new Date();
      context += `Date actuelle: ${today.toLocaleDateString('fr-FR', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })}`;
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
   * 📝 PROMPT : Analyse (JSON simple) - BASÉ 100% SUR DRIVE
   */
  _buildAnalysisSystemPrompt(driveContext) {
    // ✅ ON UTILISE UNIQUEMENT LE CONTEXTE DRIVE (qui contient TOUT)
    return `${driveContext}

---

## TÂCHE D'ANALYSE

Analyse le message suivant et détermine s'il est pertinent pour ton entreprise.

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
   * 📝 PROMPT : Génération (TEXTE pur) - BASÉ 100% SUR DRIVE
   */
  _buildResponseSystemPrompt(driveContext) {
    // ✅ ON UTILISE UNIQUEMENT LE CONTEXTE DRIVE (qui contient déjà TOUT)
    return `${driveContext}

---

## TÂCHE DE GÉNÉRATION DE RÉPONSE

Génère une réponse professionnelle au client en te basant STRICTEMENT sur les informations ci-dessus.

**RÈGLES ABSOLUES** :
1. Réponds en français naturel et fluide
2. Sois concis (3-5 phrases maximum)
3. **UTILISE UNIQUEMENT** les informations présentes dans le contexte ci-dessus
4. **POUR LES HORAIRES** : Utilise EXACTEMENT les horaires mentionnés dans "## HORAIRES D'OUVERTURE" ci-dessus. N'invente JAMAIS d'horaires.
5. **POUR LES PRESTATIONS** : Mentionne UNIQUEMENT les prestations listées dans "## PRESTATIONS DISPONIBLES" ci-dessus avec leurs vrais prix.
6. Si une information n'est PAS dans le contexte ci-dessus, dis "Je vais vérifier" plutôt que d'inventer
7. Respecte les INSTRUCTIONS SPÉCIFIQUES mentionnées plus haut
8. Signe avec le nom de l'entreprise mentionné dans le contexte

**⚠️ INTERDICTIONS STRICTES** :
❌ N'invente JAMAIS d'horaires si tu ne les vois pas dans "## HORAIRES D'OUVERTURE"
❌ N'invente JAMAIS de prix si tu ne les vois pas dans "## PRESTATIONS"
❌ N'invente JAMAIS d'adresse ou de téléphone

**IMPORTANT** : Réponds UNIQUEMENT avec le texte de l'email à envoyer.
AUCUN JSON, AUCUNE explication, AUCUN commentaire, AUCUN formatage markdown.
Juste le texte brut de l'email.`;
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
