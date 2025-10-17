const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ✅ Schema utilisateur ENRICHI
const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
  },
  businessName: {
    type: String,
    required: true,
  },
  deviceId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  subscription: {
    type: String,
    enum: ['free', 'premium', 'enterprise'],
    default: 'free',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastLoginAt: {
    type: Date,
    default: Date.now,
  },

  // 🆕 CONFIGURATION EMAIL (déjà présent ?)
  emailConfig: {
    provider: { type: String, enum: ['gmail', 'outlook'] },
    accessToken: String,
    refreshToken: String,
    email: String,
    connectedAt: Date,
    webhookExpiration: Date,
  },

  // 🆕 CONFIGURATION IA
  aiSettings: {
    isEnabled: { type: Boolean, default: false },
    autoReplyEnabled: { type: Boolean, default: false },
    requireValidation: { type: Boolean, default: true },
    
    // Informations entreprise
    salonName: { type: String, default: '' },
    ownerEmail: String,
    ownerPhone: String,
    address: String,
    website: String,
    description: String,
    
    // Instructions IA
    role: { type: String, default: 'Assistant virtuel pour la gestion des rendez-vous et réponses clients' },
    instructions: { type: String, default: 'Sois professionnelle et amicale. Réponds uniquement aux demandes liées à mon activité.' },
    tone: { type: String, default: 'professionnel' },
    pricing: { type: String, default: '' },
    
    // Horaires d'ouverture
    schedule: {
      type: Map,
      of: {
        isClosed: Boolean,
        openTime: String,
        closeTime: String
      },
      default: {
        'Lundi': { isClosed: false, openTime: '09:00', closeTime: '19:00' },
        'Mardi': { isClosed: false, openTime: '09:00', closeTime: '19:00' },
        'Mercredi': { isClosed: false, openTime: '09:00', closeTime: '19:00' },
        'Jeudi': { isClosed: false, openTime: '09:00', closeTime: '19:00' },
        'Vendredi': { isClosed: false, openTime: '09:00', closeTime: '19:00' },
        'Samedi': { isClosed: false, openTime: '10:00', closeTime: '18:00' },
        'Dimanche': { isClosed: true, openTime: '09:00', closeTime: '19:00' },
      }
    },
    
    // Paramètres OpenAI
    apiKey: String,
    aiModel: { type: String, default: 'gpt-4' },
    temperature: { type: Number, default: 0.7 },
    maxTokens: { type: Number, default: 500 },
    
    lastUpdated: { type: Date, default: Date.now }
  },

  // 🆕 Token FCM pour notifications push
  fcmToken: String,
});

// ✅ Hash du mot de passe
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  
  try {
    this.password = await bcrypt.hash(this.password, 12);
    next();
  } catch (error) {
    next(error);
  }
});

// ✅ Comparer mot de passe
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// 🆕 MÉTHODE : Construire le contexte IA dynamiquement
userSchema.methods.buildAIContext = async function() {
  const Prestation = mongoose.model('Prestation');
  const Appointment = mongoose.model('Appointment');

  // Récupérer les prestations actives
  const prestations = await Prestation.find({ 
    userId: this._id, 
    isActive: true 
  });

  // Récupérer les RDV des 7 prochains jours
  const now = new Date();
  const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const appointments = await Appointment.find({
    userId: this._id,
    dateTime: { $gte: now, $lt: weekLater },
    status: { $ne: 'annule' }
  }).sort({ dateTime: 1 });

  let context = `=== INFORMATIONS SUR L'ENTREPRISE ===\n`;
  context += `Nom: ${this.aiSettings.salonName || this.businessName}\n`;
  if (this.aiSettings.address) context += `Adresse: ${this.aiSettings.address}\n`;
  if (this.aiSettings.ownerPhone) context += `Téléphone: ${this.aiSettings.ownerPhone}\n`;
  if (this.aiSettings.ownerEmail) context += `Email: ${this.aiSettings.ownerEmail}\n`;
  if (this.aiSettings.website) context += `Site web: ${this.aiSettings.website}\n`;
  if (this.aiSettings.description) context += `Description: ${this.aiSettings.description}\n`;

  context += `\n=== HORAIRES D'OUVERTURE ===\n`;
  if (this.aiSettings.schedule) {
    const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    days.forEach(day => {
      const schedule = this.aiSettings.schedule.get(day);
      if (schedule) {
        context += schedule.isClosed 
          ? `${day}: Fermé\n`
          : `${day}: ${schedule.openTime} - ${schedule.closeTime}\n`;
      }
    });
  }

  context += `\n=== TON RÔLE ===\n${this.aiSettings.role}\n`;

  if (this.aiSettings.pricing) {
    context += `\n=== TARIFS ===\n${this.aiSettings.pricing}\n`;
  }

  if (prestations.length > 0) {
    context += `\n=== PRESTATIONS DISPONIBLES ===\n`;
    prestations.forEach(p => {
      context += `- ${p.name} (${p.category})\n`;
      context += `  Durée: ${p.defaultDurationMinutes} min\n`;
      context += `  Prix: ${p.defaultPrice.toFixed(2)} €\n`;
    });
  } else {
    context += `\n⚠️ Aucune prestation configurée.\n`;
  }

  context += `\n=== CRÉNEAUX OCCUPÉS (7 PROCHAINS JOURS) ===\n`;
  if (appointments.length > 0) {
    appointments.forEach(apt => {
      const date = new Date(apt.dateTime);
      context += `- ${date.getDate()}/${date.getMonth() + 1} à ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')} (${apt.durationMinutes} min) - ${apt.prestationName}\n`;
    });
  } else {
    context += `Aucun rendez-vous programmé.\n`;
  }

  context += `\n=== INSTRUCTIONS SPÉCIFIQUES ===\n${this.aiSettings.instructions}\n`;
  context += `Ton à adopter: ${this.aiSettings.tone}\n`;

  return context;
};

// 🆕 MÉTHODE : Récupérer les paramètres IA
userSchema.methods.getAISettings = function() {
  return this.aiSettings;
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
