const driveService = require('./google-drive.service');

/**
 * Service de construction du contexte IA depuis Drive
 * 
 * Bonnes pratiques:
 * - Génération de prompts structurés
 * - Gestion des données manquantes
 * - Format optimisé pour l'IA
 * - Cache intégré via driveService
 */
class ContextBuilderService {
  
  /**
   * Construire le contexte complet pour l'IA
   * @param {string} accessToken
   * @param {string} userId
   * @param {Object} options - Options additionnelles
   * @returns {Promise<string>}
   */
  async buildContextFromDrive(accessToken, userId, options = {}) {
    const startTime = Date.now();
    
    try {
      console.log(`[Context:${userId}] 🔨 Construction contexte IA...`);

      // Charger les données Drive en parallèle
      const { businessInfo, planningInfo } = await driveService.loadAllUserData(accessToken, userId);

      // Construire les sections du prompt
      const sections = [];

      // En-tête
      sections.push(this._buildHeader(businessInfo));

      // Informations business
      if (!businessInfo._empty) {
        sections.push(this._buildBusinessSection(businessInfo));
      }

      // Prestations
      if (businessInfo.prestations && businessInfo.prestations.length > 0) {
        sections.push(this._buildPrestationsSection(businessInfo.prestations));
      }

      // Équipe
      if (businessInfo.team && businessInfo.team.length > 0) {
        sections.push(this._buildTeamSection(businessInfo.team));
      }

      // Horaires d'ouverture
      if (planningInfo.openingHours) {
        sections.push(this._buildOpeningHoursSection(planningInfo.openingHours));
      }

      // Jours fermés
      if (planningInfo.closedDates && planningInfo.closedDates.length > 0) {
        sections.push(this._buildClosedDatesSection(planningInfo.closedDates));
      }

      // Instructions IA personnalisées
      if (businessInfo.aiInstructions) {
        sections.push(this._buildInstructionsSection(businessInfo.aiInstructions));
      }

      // Rendez-vous (optionnel, selon options)
      if (options.includeAppointments && planningInfo.appointments) {
        sections.push(this._buildAppointmentsSection(planningInfo.appointments));
      }

      // Pied de page avec règles générales
      sections.push(this._buildFooter());

      const context = sections.filter(Boolean).join('\n\n');
      
      const duration = Date.now() - startTime;
      console.log(`[Context:${userId}] ✅ Contexte généré (${context.length} caractères) en ${duration}ms`);

      return context;

    } catch (error) {
      console.error(`[Context:${userId}] ❌ Erreur construction contexte:`, error.message);
      
      // Retourner un contexte minimal en cas d'erreur
      return this._buildMinimalContext();
    }
  }

  /**
   * SECTIONS DU PROMPT
   */

  _buildHeader(businessInfo) {
    const businessName = businessInfo.business?.name || 'cette entreprise';
    
    return `# CONTEXTE ENTREPRISE

Tu es un assistant virtuel intelligent pour ${businessName}.
Ton rôle est d'aider les clients à prendre rendez-vous et répondre à leurs questions.`;
  }

  _buildBusinessSection(businessInfo) {
    const { business } = businessInfo;
    if (!business) return null;

    const parts = ['## INFORMATIONS ENTREPRISE'];

    if (business.name) parts.push(`- Nom: ${business.name}`);
    if (business.activity) parts.push(`- Activité: ${business.activity}`);
    if (business.description) parts.push(`- Description: ${business.description}`);
    if (business.address) parts.push(`- Adresse: ${business.address}`);
    if (business.phone) parts.push(`- Téléphone: ${business.phone}`);

    return parts.length > 1 ? parts.join('\n') : null;
  }

  _buildPrestationsSection(prestations) {
    const parts = ['## PRESTATIONS DISPONIBLES'];

    prestations.forEach((p, index) => {
      let line = `${index + 1}. **${p.name}**`;
      if (p.duration) line += ` - ${p.duration} minutes`;
      if (p.price) line += ` - ${p.price}€`;
      if (p.description) line += `\n   ${p.description}`;
      parts.push(line);
    });

    return parts.join('\n');
  }

  _buildTeamSection(team) {
    const parts = ['## ÉQUIPE'];

    team.forEach((member, index) => {
      let line = `${index + 1}. **${member.name}**`;
      if (member.role) line += ` - ${member.role}`;
      if (member.specialties) line += ` (${member.specialties})`;
      parts.push(line);
    });

    return parts.join('\n');
  }

  _buildOpeningHoursSection(openingHours) {
    const parts = ['## HORAIRES D\'OUVERTURE'];

    // Traduire les jours en français si nécessaire
    const daysMap = {
      'monday': 'Lundi',
      'tuesday': 'Mardi',
      'wednesday': 'Mercredi',
      'thursday': 'Jeudi',
      'friday': 'Vendredi',
      'saturday': 'Samedi',
      'sunday': 'Dimanche',
      'lundi': 'Lundi',
      'mardi': 'Mardi',
      'mercredi': 'Mercredi',
      'jeudi': 'Jeudi',
      'vendredi': 'Vendredi',
      'samedi': 'Samedi',
      'dimanche': 'Dimanche'
    };

    Object.entries(openingHours).forEach(([day, hours]) => {
      const frenchDay = daysMap[day.toLowerCase()] || day;
      parts.push(`- **${frenchDay}**: ${hours}`);
    });

    return parts.join('\n');
  }

  _buildClosedDatesSection(closedDates) {
    const parts = ['## FERMETURES EXCEPTIONNELLES'];

    closedDates.forEach(date => {
      parts.push(`- ${date}`);
    });

    return parts.join('\n');
  }

  _buildInstructionsSection(instructions) {
    return `## INSTRUCTIONS SPÉCIFIQUES

${instructions}`;
  }

  _buildAppointmentsSection(appointments) {
    if (!appointments || appointments.length === 0) return null;

    const parts = ['## RENDEZ-VOUS À VENIR'];

    // Ne montrer que les prochains rendez-vous (max 5)
    const upcoming = appointments
      .filter(apt => new Date(apt.date) >= new Date())
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 5);

    upcoming.forEach(apt => {
      parts.push(`- ${apt.date} à ${apt.time}: ${apt.service} avec ${apt.client}`);
    });

    return parts.join('\n');
  }

  _buildFooter() {
    return `## RÈGLES GÉNÉRALES

1. **Sois professionnel et courtois** dans toutes tes réponses
2. **Vérifie les disponibilités** avant de proposer un créneau
3. **Pose des questions** si tu as besoin de plus d'informations
4. **Confirme toujours** les détails du rendez-vous (date, heure, prestation)
5. **Propose des alternatives** si le créneau demandé n'est pas disponible
6. **Reste dans ton rôle** : tu ne peux que gérer les rendez-vous et répondre aux questions sur l'entreprise

Date actuelle: ${new Date().toLocaleDateString('fr-FR', { 
  weekday: 'long', 
  year: 'numeric', 
  month: 'long', 
  day: 'numeric' 
})}`;
  }

  _buildMinimalContext() {
    return `# ASSISTANT VIRTUEL

Tu es un assistant pour la gestion de rendez-vous.
Le contexte complet n'est pas disponible actuellement.
Sois courtois et explique que tu as besoin que l'utilisateur configure son profil.`;
  }

  /**
   * Générer un prompt complet pour l'analyse
   * @param {string} context - Contexte depuis Drive
   * @param {string} messageBody - Message du client
   * @param {Array} conversationHistory - Historique (optionnel)
   * @returns {string}
   */
  buildAnalysisPrompt(context, messageBody, conversationHistory = []) {
    let prompt = context + '\n\n---\n\n';

    if (conversationHistory.length > 0) {
      prompt += '## HISTORIQUE CONVERSATION\n\n';
      conversationHistory.slice(-5).forEach(msg => {
        prompt += `- ${msg.from}: ${msg.body.substring(0, 150)}\n`;
      });
      prompt += '\n';
    }

    prompt += `## MESSAGE CLIENT\n\n${messageBody}\n\n`;
    prompt += `## TÂCHE\n\n`;
    prompt += `Analyse ce message et détermine:\n`;
    prompt += `1. **Pertinence**: Est-ce lié à mon activité? (score 0-1)\n`;
    prompt += `2. **Intention**: Que veut le client? (prise_rdv, annulation, question, autre)\n`;
    prompt += `3. **Confiance**: Quel est ton niveau de certitude? (score 0-1)\n`;
    prompt += `4. **Détails**: Extrait les informations clés (date, heure, prestation souhaitée, etc.)\n\n`;
    prompt += `Réponds UNIQUEMENT en JSON valide.`;

    return prompt;
  }

  /**
   * Générer un prompt complet pour la génération de réponse
   * @param {string} context - Contexte depuis Drive
   * @param {string} messageBody - Message du client
   * @param {Object} analysis - Résultat de l'analyse
   * @param {Array} conversationHistory - Historique (optionnel)
   * @returns {string}
   */
  buildResponsePrompt(context, messageBody, analysis, conversationHistory = []) {
    let prompt = context + '\n\n---\n\n';

    if (conversationHistory.length > 0) {
      prompt += '## HISTORIQUE CONVERSATION\n\n';
      conversationHistory.slice(-5).forEach(msg => {
        prompt += `- ${msg.from}: ${msg.body.substring(0, 150)}\n`;
      });
      prompt += '\n';
    }

    prompt += `## MESSAGE CLIENT\n\n${messageBody}\n\n`;
    
    prompt += `## ANALYSE DU MESSAGE\n\n`;
    prompt += `- Intention détectée: ${analysis.intent || 'inconnue'}\n`;
    prompt += `- Confiance: ${((analysis.confidence || 0) * 100).toFixed(0)}%\n`;
    if (analysis.details) {
      prompt += `- Détails: ${JSON.stringify(analysis.details)}\n`;
    }
    prompt += '\n';

    prompt += `## TÂCHE\n\n`;
    prompt += `Génère une réponse professionnelle et personnalisée pour ce client.\n`;
    prompt += `La réponse doit:\n`;
    prompt += `- Être courtoise et naturelle\n`;
    prompt += `- Répondre précisément à la demande\n`;
    prompt += `- Utiliser les informations du contexte\n`;
    prompt += `- Proposer des créneaux si pertinent\n`;
    prompt += `- Être concise (3-5 phrases maximum)\n\n`;
    prompt += `Réponds UNIQUEMENT avec le texte de la réponse, sans JSON ni formatage.`;

    return prompt;
  }
}

// Export singleton
module.exports = new ContextBuilderService();
