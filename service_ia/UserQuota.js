const mongoose = require('mongoose');

// ✅ Configuration des quotas par plan d'abonnement
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
    monthlyCalls: -1, // Illimité
    maxEmailsPerDay: -1, // Illimité
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
  
  // ✅ Plan d'abonnement actuel (synchronisé avec User.subscription.plan)
  currentPlan: {
    type: String,
    enum: ['free', 'basic', 'premium', 'enterprise'],
    default: 'free'
  },
  
  // ✅ Limite quotidienne (calculée selon le plan ou custom)
  dailyTokenLimit: {
    type: Number,
    default: function() {
      return QUOTA_PLANS[this.currentPlan]?.dailyTokens || 10000;
    }
  },
  
  tokensUsedToday: {
    type: Number,
    default: 0
  },
  
  // ✅ Compteurs mensuels
  monthlyCallsLimit: {
    type: Number,
    default: function() {
      return QUOTA_PLANS[this.currentPlan]?.monthlyCalls || 100;
    }
  },
  
  callsUsedThisMonth: {
    type: Number,
    default: 0
  },
  
  emailsSentToday: {
    type: Number,
    default: 0
  },
  
  maxEmailsPerDay: {
    type: Number,
    default: function() {
      return QUOTA_PLANS[this.currentPlan]?.maxEmailsPerDay || 20;
    }
  },
  
  // Dates de réinitialisation
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
  
  // Historique (30 derniers jours)
  history: [{
    date: Date,
    tokensUsed: Number,
    callsMade: Number,
    emailsSent: Number
  }],
  
  // Blocage
  isBlocked: {
    type: Boolean,
    default: false
  },
  
  blockedUntil: Date,
  
  blockedReason: {
    type: String,
    enum: ['tokens', 'calls', 'emails', 'expired_subscription']
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// ✅ MÉTHODE : Synchroniser avec le plan de l'utilisateur
userQuotaSchema.methods.syncWithUserPlan = async function() {
  try {
    const User = mongoose.model('User');
    const user = await User.findById(this.userId).select('subscription');
    
    if (!user) {
      console.warn(`⚠️ [Quota] User ${this.userId} non trouvé`);
      return this;
    }
    
    const userPlan = user.subscription?.plan || 'free';
    const isActive = user.subscription?.isActive !== false;
    
    // Vérifier si abonnement expiré
    if (!isActive || (user.subscription?.endDate && user.subscription.endDate < new Date())) {
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
      if (user.subscription?.customQuotas?.dailyTokens) {
        this.dailyTokenLimit = user.subscription.customQuotas.dailyTokens;
      } else {
        this.dailyTokenLimit = planConfig.dailyTokens;
      }
      
      if (user.subscription?.customQuotas?.monthlyCalls) {
        this.monthlyCallsLimit = user.subscription.customQuotas.monthlyCalls;
      } else {
        this.monthlyCallsLimit = planConfig.monthlyCalls;
      }
      
      if (user.subscription?.customQuotas?.maxEmailsPerDay) {
        this.maxEmailsPerDay = user.subscription.customQuotas.maxEmailsPerDay;
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

// ✅ MÉTHODE : Vérifier et réinitialiser les quotas quotidiens
userQuotaSchema.methods.checkAndReset = function() {
  const now = new Date();
  const midnightToday = new Date(now);
  midnightToday.setUTCHours(0, 0, 0, 0);
  
  // Reset quotidien
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
  
  // Reset mensuel
  const firstDayThisMonth = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);
  if (this.lastMonthlyResetDate < firstDayThisMonth) {
    this.callsUsedThisMonth = 0;
    this.lastMonthlyResetDate = firstDayThisMonth;
    console.log(`📅 [Quota] Reset mensuel pour user ${this.userId}`);
  }
  
  return this;
};

// ✅ MÉTHODE : Utiliser des tokens
userQuotaSchema.methods.useTokens = function(amount) {
  this.checkAndReset();
  
  // Enterprise = illimité
  if (this.currentPlan === 'enterprise') {
    this.tokensUsedToday += amount;
    this.updatedAt = new Date();
    return {
      success: true,
      remaining: -1, // Illimité
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

// ✅ MÉTHODE : Incrémenter compteur d'emails
userQuotaSchema.methods.incrementEmailsSent = function() {
  this.checkAndReset();
  
  // Enterprise = illimité
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

// ✅ MÉTHODE : Incrémenter compteur d'appels API
userQuotaSchema.methods.incrementAPICalls = function() {
  // Enterprise = illimité
  if (this.currentPlan === 'enterprise' || this.monthlyCallsLimit === -1) {
    this.callsUsedThisMonth++;
    return { success: true, remaining: -1 };
  }
  
  if (this.callsUsedThisMonth >= this.monthlyCallsLimit) {
    this.isBlocked = true;
    this.blockedReason = 'calls';
    
    // Bloquer jusqu'au début du mois prochain
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

// ✅ Export des plans pour utilisation externe
userQuotaSchema.statics.QUOTA_PLANS = QUOTA_PLANS;

module.exports = mongoose.model('UserQuota', userQuotaSchema);
