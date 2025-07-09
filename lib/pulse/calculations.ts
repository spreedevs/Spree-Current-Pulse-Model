// lib/pulse/calculations.ts

import { VenueMetrics, PulseData } from './types'

export class PulseCalculator {
  
  /**
   * Calculate pulse from venue metrics (Spree venues)
   */
  calculateFromMetrics(metrics: VenueMetrics): Pick<PulseData, 'value'> {
    let pulse = 5.0 // Base
    
    // 1. Activity Score (0-6 points based on check-ins)
    pulse = this.calculateActivityScore(metrics.activeCheckIns)
    
    // 2. Momentum Boost (0-1 point based on trend)
    const momentumBoost = this.calculateMomentumBoost(metrics.checkInTrend)
    pulse += momentumBoost
    
    // 3. Vibe Boost (0-1 point based on sentiment)
    const vibeBoost = this.calculateVibeBoost(
      metrics.recentSentiment,
      metrics.vibePhotosCount
    )
    pulse += vibeBoost
    
    // 4. Wait Time Indicator (0-2 points)
    const waitBoost = this.calculateWaitTimeBoost(metrics.reportedWaitTime)
    pulse += waitBoost
    
    // 5. Apply time modifiers
    pulse = this.applyTimeModifiers(pulse, metrics.hourOfDay, metrics.dayOfWeek)
    
    // 6. Special event boost
    if (metrics.isSpecialEvent) {
      pulse *= 1.2
    }
    
    // Ensure bounds
    const finalPulse = Math.min(10, Math.max(0, pulse))
    
    return {
      value: Math.round(finalPulse * 10) / 10
    }
  }
  
  /**
   * Calculate activity score from check-ins
   */
  private calculateActivityScore(activeCheckIns: number): number {
    if (activeCheckIns >= 100) return 9.0
    if (activeCheckIns >= 75) return 8.5
    if (activeCheckIns >= 50) return 8.0
    if (activeCheckIns >= 30) return 7.0
    if (activeCheckIns >= 20) return 6.5
    if (activeCheckIns >= 15) return 6.0
    if (activeCheckIns >= 10) return 5.5
    if (activeCheckIns >= 5) return 5.0
    if (activeCheckIns >= 2) return 4.5
    if (activeCheckIns > 0) return 4.0
    return 3.0
  }
  
  /**
   * Calculate momentum boost from trend
   */
  private calculateMomentumBoost(trend: VenueMetrics['checkInTrend']): number {
    switch (trend) {
      case 'surging': return 1.0
      case 'increasing': return 0.5
      case 'stable': return 0
      case 'decreasing': return -0.5
      default: return 0
    }
  }
  
  /**
   * Calculate vibe boost from sentiment and photos
   */
  private calculateVibeBoost(sentiment: number, photoCount: number): number {
    let boost = 0
    
    // Sentiment boost (max 0.5)
    if (sentiment > 0.7) boost += 0.5
    else if (sentiment > 0.3) boost += 0.3
    else if (sentiment > 0) boost += 0.1
    
    // Photo activity boost (max 0.5)
    if (photoCount >= 10) boost += 0.5
    else if (photoCount >= 5) boost += 0.3
    else if (photoCount >= 2) boost += 0.2
    else if (photoCount > 0) boost += 0.1
    
    return Math.min(1.0, boost)
  }
  
  /**
   * Calculate wait time boost
   */
  private calculateWaitTimeBoost(waitTime: number | null): number {
    if (!waitTime) return 0
    
    if (waitTime >= 45) return 2.0
    if (waitTime >= 30) return 1.5
    if (waitTime >= 20) return 1.0
    if (waitTime >= 10) return 0.7
    if (waitTime >= 5) return 0.5
    return 0
  }
  
  /**
   * Apply time-based modifiers
   */
  applyTimeModifiers(basePulse: number, hour: number, dayOfWeek: number): number {
    let modifier = 1.0
    
    // Weekend nights (Thu-Sat 10pm-2am)
    if ((dayOfWeek >= 4 || dayOfWeek === 0) && (hour >= 22 || hour <= 2)) {
      modifier = 1.15
    }
    // Regular evenings (8pm-12am)
    else if (hour >= 20 || hour <= 0) {
      modifier = 1.1
    }
    // Happy hour (5-7pm weekdays)
    else if (dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= 17 && hour <= 19) {
      modifier = 1.05
    }
    // Late night weekdays (less activity expected)
    else if (dayOfWeek >= 1 && dayOfWeek <= 3 && (hour >= 23 || hour <= 1)) {
      modifier = 0.9
    }
    // Daytime (significant penalty)
    else if (hour >= 6 && hour < 17) {
      modifier = 0.7
    }
    // Very early morning
    else if (hour >= 3 && hour < 6) {
      modifier = 0.5
    }
    
    return basePulse * modifier
  }
  
  /**
   * Convert Google's 0-100 scale to Spree's 0-10
   */
  convertGoogleToSpree(googleBusyness: number): number {
    // Non-linear conversion optimized for nightlife
    // Google rarely shows 100% for bars, so we adjust the scale
    
    if (googleBusyness >= 90) return 9.5
    if (googleBusyness >= 80) return 8.5 + (googleBusyness - 80) / 20
    if (googleBusyness >= 70) return 7.5 + (googleBusyness - 70) / 20
    if (googleBusyness >= 60) return 7.0 + (googleBusyness - 60) / 40
    if (googleBusyness >= 50) return 6.5 + (googleBusyness - 50) / 40
    if (googleBusyness >= 40) return 6.0 + (googleBusyness - 40) / 40
    if (googleBusyness >= 30) return 5.5 + (googleBusyness - 30) / 40
    if (googleBusyness >= 20) return 5.0 + (googleBusyness - 20) / 40
    if (googleBusyness >= 10) return 4.0 + (googleBusyness - 10) / 20
    if (googleBusyness > 0) return 3.0 + googleBusyness / 10
    return 3.0 // Minimum pulse for open venue
  }
  
  /**
   * Calculate confidence score based on data quality
   */
  calculateConfidence(
    dataPoints: number,
    dataAge: number, // minutes
    dataSource: 'spree' | 'community' | 'google'
  ): number {
    let baseConfidence = 0.5
    
    // Source-based confidence
    switch (dataSource) {
      case 'spree':
        baseConfidence = 0.9
        break
      case 'community':
        baseConfidence = 0.7
        break
      case 'google':
        baseConfidence = 0.6
        break
    }
    
    // Adjust for data quantity
    if (dataPoints >= 20) baseConfidence += 0.1
    else if (dataPoints >= 10) baseConfidence += 0.05
    else if (dataPoints < 3) baseConfidence -= 0.2
    
    // Adjust for data freshness
    if (dataAge < 15) baseConfidence += 0.05
    else if (dataAge > 60) baseConfidence -= 0.1
    else if (dataAge > 120) baseConfidence -= 0.2
    
    return Math.min(1, Math.max(0.1, baseConfidence))
  }
}
