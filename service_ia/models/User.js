const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ✅ FORCER LA SUPPRESSION DU MODÈLE EXISTANT
if (mongoose.models.User) {
  delete mongoose.models.User;
  delete mongoose.connection.models.User;
}

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
    index: true,
  },
  
  // ✅ Structure avec protection contre les anciennes données
  subscription: {
    type: mongoose.Schema.Types.Mixed, // Permet string temporairement
    default: {
      plan: 'free',
      isActive: true,
      startDate: Date.now,
      endDate: null,
      customQuotas: {
        dailyTokens: null,
        monthlyCalls: null,
        maxEmailsPerDay: null
      }
    }
  },

  // ✅ AJOUT : Créer le quota immédiatement
const UserQuota = require('../models/UserQuota');
await UserQuota.create({
  userId: user._id,
  currentPlan: 'free',
  dailyTokenLimit: 10000,
  tokensUsedToday: 0,
  monthlyCallsLimit: 100,
  callsUsedThisMonth: 0,
  maxEmailsPerDay: 20,
  emailsSentToday: 0
});

console.log(`✅ [Auth] Quota free initialisé pour ${email}`);
  
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

  emailConfig: {
    provider: { type: String, enum: ['gmail', 'outlook'] },
    accessToken: String,
    refreshToken: String,
    email: String,
    connectedAt: Date,
    webhookExpiration: Date,
  },

  aiSettings: {
    isEnabled: { type: Boolean, default: false },
    autoReplyEnabled: { type: Boolean, default: false },
    requireValidation: { type: Boolean, default: true },
    
    salonName: { type: String, default: '' },
    ownerEmail: String,
    ownerPhone: String,
    address: String,
    website: String,
    description: String,
    
    role: { type: String, default: 'Assistant virtuel pour la gestion des rendez-vous et réponses clients' },
    instructions: { type: String, default: 'Sois professionnelle et amicale. Réponds uniquement aux demandes liées à mon activité.' },
    tone: { type: String, default: 'professionnel' },
    pricing: { type: String, default: '' },
    
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
    
    apiKey: String,
    aiModel: { type: String, default: 'gpt-4' },
    temperature: { type: Number, default: 0.7 },
    maxTokens: { type: Number, default: 500 },
    
    lastUpdated: { type: Date, default: Date.now }
  },

  fcmToken: String,
}, {
  id: false,
  toJSON: { virtuals: false },
  toObject: { virtuals: false }
});

// ✅ MIDDLEWARE DE PROTECTION : Normaliser subscription avant sauvegarde
userSchema.pre('save', async function (next) {
  try {
    // Normaliser subscription si nécessaire
    if (typeof this.subscription === 'string') {
      console.log(`⚠️ [User] Normalisation subscription pour ${this.email}: "${this.subscription}" → objet`);
      
      const plan = ['free', 'basic', 'premium', 'enterprise'].includes(this.subscription.toLowerCase())
        ? this.subscription.toLowerCase()
        : 'free';
      
      this.subscription = {
        plan: plan,
        isActive: true,
        startDate: this.createdAt || new Date(),
        endDate: null,
        customQuotas: {
          dailyTokens: null,
          monthlyCalls: null,
          maxEmailsPerDay: null
        }
      };
    }
    
    // Hash password si modifié
    if (this.isModified('password')) {
      this.password = await bcrypt.hash(this.password, 12);
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// ✅ MÉTHODE HELPER : Obtenir subscription de façon sécurisée
userSchema.methods.getSubscription = function() {
  // Gérer les anciens formats
  if (typeof this.subscription === 'string') {
    return {
      plan: this.subscription.toLowerCase(),
      isActive: true,
      startDate: this.createdAt || new Date(),
      endDate: null,
      customQuotas: {
        dailyTokens: null,
        monthlyCalls: null,
        maxEmailsPerDay: null
      }
    };
  }
  
  // Format moderne
  return this.subscription || {
    plan: 'free',
    isActive: true,
    startDate: this.createdAt || new Date(),
    endDate: null,
    customQuotas: {
      dailyTokens: null,
      monthlyCalls: null,
      maxEmailsPerDay: null
    }
  };
};

userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.buildAIContext = async function() {
  const Prestation = mongoose.model('Prestation');
  const Appointment = mongoose.model('Appointment');

  const prestations = await Prestation.find({ 
    userId: this._id, 
    isActive: true 
  });

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

userSchema.methods.getAISettings = function() {
  return this.aiSettings;
};

const User = mongoose.model('User', userSchema);
module.exports = User;
