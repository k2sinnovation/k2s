const UserQuota = require('./UserQuota');

class QuotaService {
  
  /**
   * 🔍 Récupérer ou créer le quota (avec sync du plan)
   */
  async getOrCreateQuota(userId) {
    let quota = await UserQuota.findOne({ userId });
    
    if (!quota) {
      console.log(`🆕 [Quota] Création quota pour user ${userId}`);
      quota = await UserQuota.create({
        userId,
        currentPlan: 'free',
        tokensUsedToday: 0
      });
    }
    
    // ✅ CRITIQUE : Synchroniser avec le plan de l'utilisateur
    await quota.syncWithUserPlan();
    
    // Vérifier si reset nécessaire
    quota.checkAndReset();
    await quota.save();
    
    return quota;
  }
  
  /**
   * ✅ Vérifier si l'utilisateur peut utiliser des tokens
   */
  async canUseTokens(userId, amount) {
    const quota = await this.getOrCreateQuota(userId);
    
    // Plan Enterprise = illimité
    if (quota.currentPlan === 'enterprise') {
      return {
        allowed: true,
        remaining: -1,
        blocked: false,
        plan: 'enterprise'
      };
    }
    
    const remaining = quota.dailyTokenLimit - quota.tokensUsedToday;
    
    if (quota.isBlocked) {
      return {
        allowed: false,
        remaining: 0,
        blocked: true,
        blockedUntil: quota.blockedUntil,
        blockedReason: quota.blockedReason,
        plan: quota.currentPlan,
        message: `Quota dépassé (${quota.blockedReason}). Déblocage: ${quota.blockedUntil?.toLocaleString('fr-FR')}`
      };
    }
    
    if (remaining < amount) {
      return {
        allowed: false,
        remaining,
        blocked: false,
        plan: quota.currentPlan,
        message: `Tokens insuffisants. ${remaining}/${quota.dailyTokenLimit} restants (plan ${quota.currentPlan}).`
      };
    }
    
    return {
      allowed: true,
      remaining,
      blocked: false,
      plan: quota.currentPlan
    };
  }
  
  /**
   * 📉 Décrémenter les tokens
   */
  async useTokens(userId, amount) {
    const quota = await this.getOrCreateQuota(userId);
    const result = quota.useTokens(amount);
    await quota.save();
    return result;
  }
  
  /**
   * 📧 Vérifier et incrémenter emails
   */
  async canSendEmail(userId) {
    const quota = await this.getOrCreateQuota(userId);
    
    if (quota.isBlocked && quota.blockedReason === 'emails') {
      return {
        allowed: false,
        remaining: 0,
        message: `Limite d'emails atteinte. Déblocage: ${quota.blockedUntil?.toLocaleString('fr-FR')}`
      };
    }
    
    const remaining = quota.maxEmailsPerDay === -1 ? -1 : quota.maxEmailsPerDay - quota.emailsSentToday;
    
    return {
      allowed: remaining !== 0,
      remaining,
      plan: quota.currentPlan
    };
  }
  
  async incrementEmailsSent(userId) {
    const quota = await this.getOrCreateQuota(userId);
    const result = quota.incrementEmailsSent();
    await quota.save();
    return result;
  }
  
  /**
   * 📊 Stats pour Flutter
   */
  async getQuotaStats(userId) {
    const quota = await this.getOrCreateQuota(userId);
    
    const planConfig = UserQuota.QUOTA_PLANS[quota.currentPlan];
    
    return {
      plan: {
        name: planConfig.name,
        level: quota.currentPlan
      },
      tokens: {
        dailyLimit: quota.dailyTokenLimit,
        used: quota.tokensUsedToday,
        remaining: quota.dailyTokenLimit === -1 ? -1 : quota.dailyTokenLimit - quota.tokensUsedToday,
        percentage: quota.dailyTokenLimit === -1 ? 0 : Math.round((quota.tokensUsedToday / quota.dailyTokenLimit) * 100)
      },
      emails: {
        dailyLimit: quota.maxEmailsPerDay,
        sent: quota.emailsSentToday,
        remaining: quota.maxEmailsPerDay === -1 ? -1 : quota.maxEmailsPerDay - quota.emailsSentToday
      },
      calls: {
        monthlyLimit: quota.monthlyCallsLimit,
        used: quota.callsUsedThisMonth,
        remaining: quota.monthlyCallsLimit === -1 ? -1 : quota.monthlyCallsLimit - quota.callsUsedThisMonth
      },
      isBlocked: quota.isBlocked,
      blockedUntil: quota.blockedUntil,
      blockedReason: quota.blockedReason,
      lastReset: quota.lastResetDate,
      history: quota.history
    };
  }
}

module.exports = new QuotaService();
