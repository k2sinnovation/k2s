// ========================================
// 📁 FICHIER 1 : migrate-subscriptions.js
// ========================================
// Script à lancer UNE FOIS pour nettoyer la DB
// Commande : node migrate-subscriptions.js

const mongoose = require('mongoose');
require('dotenv').config();

async function migrateSubscriptions() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connecté à MongoDB');

    const User = mongoose.model('User');
    
    // Trouver tous les users où subscription est une string
    const usersToMigrate = await User.find({
      $or: [
        { subscription: { $type: 'string' } },
        { subscription: { $exists: false } },
        { 'subscription.plan': { $exists: false } }
      ]
    });

    console.log(`🔍 ${usersToMigrate.length} utilisateur(s) à migrer`);

    for (const user of usersToMigrate) {
      const oldSubscription = user.subscription;
      
      // Déterminer le plan
      let plan = 'free';
      if (typeof oldSubscription === 'string') {
        plan = oldSubscription;
      } else if (oldSubscription?.plan) {
        plan = oldSubscription.plan;
      }

      // Créer la nouvelle structure
      user.subscription = {
        plan: plan,
        isActive: true,
        startDate: user.createdAt || new Date(),
        endDate: null,
        customQuotas: {
          dailyTokens: null,
          monthlyCalls: null,
          maxEmailsPerDay: null
        }
      };

      await user.save();
      console.log(`✅ ${user.email} : ${oldSubscription} → { plan: "${plan}" }`);
    }

    console.log('\n✅ Migration terminée avec succès !');
    process.exit(0);

  } catch (error) {
    console.error('❌ Erreur migration:', error);
    process.exit(1);
  }
}

// ✅ Importer le modèle User
const User = require('./models/User');

migrateSubscriptions();


// ========================================
// 📁 FICHIER 2 : models/UserQuota.js (CORRIGÉ)
// ========================================

const mongoose = require('mongoose');

const QUOTA_PLANS = {
  free: {
    dailyTokens: 10000,
    monthlyCalls: 100,
    maxEmailsPerDay: 20,
    name: 'Gratuit'
  },
  basic: {
    dailyTokens: 50000,
    monthlyCalls: 1000,
    maxEmailsPerDay: 100,
    name: 'Basic'
  },
  premium: {
    dailyTokens: 200000,
    monthlyCalls: 5000,
    maxEmailsPerDay: 500,
    name: 'Premium'
  },
  enterprise: {
    dailyTokens: 1000000,
    monthlyCalls: -1,
    maxEmailsPerDay: -1,
    name: 'Enterprise'
  }
};

const userQuotaSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  
  currentPlan: {
    type: String,
    enum: ['free', 'basic', 'premium', 'enterprise'],
    default: 'free'
  },
  
  dailyTokenLimit: { type: Number, default: 10000 },
  tokensUsedToday: { type: Number, default: 0 },
  monthlyCallsLimit: { type: Number, default: 100 },
  callsUsedThisMonth: { type: Number, default: 0 },
  emailsSentToday: { type: Number, default: 0 },
  maxEmailsPerDay: { type: Number, default: 20 },
  
  lastResetDate: {
    type: Date,
    default: () => {
      const now = new Date();
      now.setUTCHours(0, 0, 0, 0);
      return now;
    }
  },
  
  lastMonthlyResetDate: {
    type: Date,
    default: () => {
      const now = new Date();
      return new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);
    }
  },
  
  history: [{
    date: Date,
    tokensUsed: Number,
    callsMade: Number,
    emailsSent: Number
  }],
  
  isBlocked: { type: Boolean, default: false },
  blockedUntil: Date,
  blockedReason: {
    type: String,
    enum: ['tokens', 'calls', 'emails', 'expired_subscription', null]
  },
  
  updatedAt: { type: Date, default: Date.now }
});

// ✅ MÉTHODE CORRIGÉE : Synchroniser avec le plan (gestion string + objet)
userQuotaSchema.methods.syncWithUserPlan = async function() {
  try {
    const User = mongoose.model('User');
    const user = await User.findById(this.userId).select('subscription createdAt').lean();
    
    if (!user) {
      console.warn(`⚠️ [Quota] User ${this.userId} non trouvé`);
      return this;
    }
    
    // ✅ Gestion des deux formats (string OU objet)
    let userPlan = 'free';
    let isActive = true;
    let endDate = null;
    let customQuotas = null;
    
    if (!user.subscription) {
      // Pas de subscription du tout
      console.warn(`⚠️ [Quota] User ${this.userId} sans subscription, défaut à 'free'`);
      userPlan = 'free';
    } else if (typeof user.subscription === 'string') {
      // Ancien format : subscription = "free"
      console.warn(`⚠️ [Quota] User ${this.userId} a subscription en string "${user.subscription}"`);
      userPlan = user.subscription;
    } else if (typeof user.subscription === 'object') {
      // Nouveau format : subscription = { plan: "free", ... }
      userPlan = user.subscription.plan || 'free';
      isActive = user.subscription.isActive !== false;
      endDate = user.subscription.endDate;
      customQuotas = user.subscription.customQuotas;
    }
    
    // Vérifier si abonnement expiré
    if (!isActive || (endDate && new Date(endDate) < new Date())) {
      console.warn(`⚠️ [Quota] Abonnement expiré pour user ${this.userId}, passage en free`);
      this.currentPlan = 'free';
      this.isBlocked = true;
      this.blockedReason = 'expired_subscription';
    } else if (this.currentPlan !== userPlan) {
      console.log(`🔄 [Quota] Mise à jour plan: ${this.currentPlan} → ${userPlan}`);
      this.currentPlan = userPlan;
      
      // Mettre à jour les limites
      const planConfig = QUOTA_PLANS[userPlan];
      
      // ✅ Vérifier si quotas custom définis
      if (customQuotas?.dailyTokens) {
        this.dailyTokenLimit = customQuotas.dailyTokens;
      } else {
        this.dailyTokenLimit = planConfig.dailyTokens;
      }
      
      if (customQuotas?.monthlyCalls) {
        this.monthlyCallsLimit = customQuotas.monthlyCalls;
      } else {
        this.monthlyCallsLimit = planConfig.monthlyCalls;
      }
      
      if (customQuotas?.maxEmailsPerDay) {
        this.maxEmailsPerDay = customQuotas.maxEmailsPerDay;
      } else {
        this.maxEmailsPerDay = planConfig.maxEmailsPerDay;
      }
      
      console.log(`✅ [Quota] Nouvelles limites: ${this.dailyTokenLimit} tokens/jour, ${this.monthlyCallsLimit} calls/mois`);
    }
    
    return this;
  } catch (error) {
    console.error(`❌ [Quota] Erreur syncWithUserPlan:`, error);
    return this;
  }
};

// ✅ Autres méthodes (checkAndReset, useTokens, etc.)
userQuotaSchema.methods.checkAndReset = function() {
  const now = new Date();
  const midnightToday = new Date(now);
  midnightToday.setUTCHours(0, 0, 0, 0);
  
  if (this.lastResetDate < midnightToday) {
    if (this.tokensUsedToday > 0 || this.emailsSentToday > 0) {
      this.history.push({
        date: this.lastResetDate,
        tokensUsed: this.tokensUsedToday,
        callsMade: 0,
        emailsSent: this.emailsSentToday
      });
      
      if (this.history.length > 30) {
        this.history = this.history.slice(-30);
      }
    }
    
    this.tokensUsedToday = 0;
    this.emailsSentToday = 0;
    this.isBlocked = false;
    this.blockedUntil = null;
    this.blockedReason = null;
    this.lastResetDate = midnightToday;
    
    console.log(`📅 [Quota] Reset quotidien pour user ${this.userId}`);
  }
  
  const firstDayThisMonth = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);
  if (this.lastMonthlyResetDate < firstDayThisMonth) {
    this.callsUsedThisMonth = 0;
    this.lastMonthlyResetDate = firstDayThisMonth;
    console.log(`📅 [Quota] Reset mensuel pour user ${this.userId}`);
  }
  
  return this;
};

userQuotaSchema.methods.useTokens = function(amount) {
  this.checkAndReset();
  
  if (this.currentPlan === 'enterprise') {
    this.tokensUsedToday += amount;
    this.updatedAt = new Date();
    return {
      success: true,
      remaining: -1,
      blocked: false,
      plan: this.currentPlan,
      message: `${amount} tokens utilisés (plan Enterprise - illimité)`
    };
  }
  
  const remaining = this.dailyTokenLimit - this.tokensUsedToday;
  
  if (remaining < amount) {
    this.isBlocked = true;
    this.blockedReason = 'tokens';
    
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    this.blockedUntil = tomorrow;
    
    console.warn(`⚠️ [Quota] User ${this.userId} (${this.currentPlan}) bloqué - tokens insuffisants`);
    
    return {
      success: false,
      remaining: 0,
      blocked: true,
      blockedUntil: this.blockedUntil,
      plan: this.currentPlan,
      message: `Quota quotidien dépassé (${this.currentPlan}). Réinitialisation à minuit.`
    };
  }
  
  this.tokensUsedToday += amount;
  this.updatedAt = new Date();
  
  const newRemaining = this.dailyTokenLimit - this.tokensUsedToday;
  
  console.log(`✅ [Quota] User ${this.userId} (${this.currentPlan}): ${amount} tokens utilisés (reste: ${newRemaining}/${this.dailyTokenLimit})`);
  
  return {
    success: true,
    remaining: newRemaining,
    blocked: false,
    plan: this.currentPlan,
    message: `${amount} tokens utilisés. ${newRemaining} restants.`
  };
};

userQuotaSchema.methods.incrementEmailsSent = function() {
  this.checkAndReset();
  
  if (this.currentPlan === 'enterprise' || this.maxEmailsPerDay === -1) {
    this.emailsSentToday++;
    return { success: true, remaining: -1 };
  }
  
  if (this.emailsSentToday >= this.maxEmailsPerDay) {
    this.isBlocked = true;
    this.blockedReason = 'emails';
    
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    this.blockedUntil = tomorrow;
    
    return {
      success: false,
      remaining: 0,
      blocked: true,
      message: `Limite d'emails quotidiens atteinte (${this.maxEmailsPerDay})`
    };
  }
  
  this.emailsSentToday++;
  return {
    success: true,
    remaining: this.maxEmailsPerDay - this.emailsSentToday
  };
};

userQuotaSchema.methods.incrementAPICalls = function() {
  if (this.currentPlan === 'enterprise' || this.monthlyCallsLimit === -1) {
    this.callsUsedThisMonth++;
    return { success: true, remaining: -1 };
  }
  
  if (this.callsUsedThisMonth >= this.monthlyCallsLimit) {
    this.isBlocked = true;
    this.blockedReason = 'calls';
    
    const nextMonth = new Date();
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 1);
    nextMonth.setUTCHours(0, 0, 0, 0);
    this.blockedUntil = nextMonth;
    
    return {
      success: false,
      remaining: 0,
      blocked: true,
      message: `Limite mensuelle d'appels atteinte (${this.monthlyCallsLimit})`
    };
  }
  
  this.callsUsedThisMonth++;
  return {
    success: true,
    remaining: this.monthlyCallsLimit - this.callsUsedThisMonth
  };
};

userQuotaSchema.statics.QUOTA_PLANS = QUOTA_PLANS;

module.exports = mongoose.model('UserQuota', userQuotaSchema);


// ========================================
// 📁 FICHIER 3 : POST-MIGRATION (à ajouter dans server.js)
// ========================================

// Ajoute cette route dans ton server.js pour vérifier
app.get('/api/admin/check-subscriptions', async (req, res) => {
  try {
    const User = require('./models/User');
    
    const stringFormat = await User.countDocuments({ subscription: { $type: 'string' } });
    const noSubscription = await User.countDocuments({ subscription: { $exists: false } });
    const objectFormat = await User.countDocuments({ 'subscription.plan': { $exists: true } });
    
    const samples = await User.find({}).limit(5).select('email subscription');
    
    res.json({
      success: true,
      stats: {
        stringFormat,
        noSubscription,
        objectFormat,
        total: stringFormat + noSubscription + objectFormat
      },
      samples: samples.map(u => ({
        email: u.email,
        subscription: u.subscription,
        type: typeof u.subscription
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
