// lib/pulse/engine.ts

import { supabase } from '@/lib/supabase'
import { 
  PulseData, 
  VenueDataSource, 
  VenueMetrics,
  VenueRecord 
} from './types'
import { PulseCalculator } from './calculations'
import { CommunityDataService } from './community'
import { GoogleBusynessService } from './services/google-service'

export class PulseEngine {
  private calculator: PulseCalculator
  private communityService: CommunityDataService
  private googleService: GoogleBusynessService
  
  constructor() {
    this.calculator = new PulseCalculator()
    this.communityService = new CommunityDataService()
    this.googleService = new GoogleBusynessService()
  }
  
  /**
   * Calculate pulse for a single venue
   */
  async calculatePulse(venueId: number): Promise<PulseData> {
    try {
      // Get venue info
      const venue = await this.getVenue(venueId)
      if (!venue) {
        throw new Error(`Venue ${venueId} not found`)
      }
      
      // Route to appropriate calculation method
      if (venue.spree_onboarded) {
        return await this.calculateSpreePulse(venue)
      } else {
        return await this.calculateNonPartnerPulse(venue)
      }
      
    } catch (error) {
      console.error(`Error calculating pulse for venue ${venueId}:`, error)
      return this.getDefaultPulse()
    }
  }
  
  /**
   * Calculate pulse for Spree partner venues
   */
  private async calculateSpreePulse(venue: VenueRecord): Promise<PulseData> {
    // Get all our metrics
    const metrics = await this.getVenueMetrics(venue.id)
    
    // Calculate pulse using our data
    const calcResult = this.calculator.calculateFromMetrics(metrics)
    const pulse: PulseData = {
      value: calcResult.value,
      confidence: 0.95, // High confidence for our data
      dataSource: VenueDataSource.SPREE,
      lastUpdated: new Date(),
      breakdown: {
        checkIns: metrics.activeCheckIns,
        waitTime: metrics.reportedWaitTime || undefined,
        vibeScore: metrics.recentSentiment
      }
    }
    
    // Log calculation
    await this.logCalculation(venue.id, pulse, metrics)
    
    return pulse
  }
  
  /**
   * Calculate pulse for non-partner venues
   */
  private async calculateNonPartnerPulse(venue: VenueRecord): Promise<PulseData> {
    let basePulse = 5.0
    let confidence = 0.5
    let dataSource = VenueDataSource.ESTIMATED
    let googleBusy = 0
    
    // Step 1: Try Google data
    if (venue.google_place_id) {
      try {
        const googleData = await this.googleService.getBusyness(venue.google_place_id)
        if (googleData && googleData.currentBusyness > 0) {
          basePulse = this.calculator.convertGoogleToSpree(googleData.currentBusyness)
          googleBusy = googleData.currentBusyness
          confidence = 0.6
          dataSource = VenueDataSource.GOOGLE
        }
      } catch (error) {
        console.warn(`Google data fetch failed for ${venue.name}`)
      }
    }
    
    // Step 2: Apply community data
    const communityData = await this.communityService.getConsensus(venue.id)
    
    if (communityData.dataPoints >= 3) {
      const { influence, adjustment } = this.communityService.calculateInfluence(communityData)
      
      if (influence > 0) {
        // Blend community data with base
        basePulse = basePulse * (1 - influence) + (basePulse + adjustment) * influence
        confidence = Math.min(0.8, confidence + influence * 0.3)
        
        if (communityData.dataPoints >= 10) {
          dataSource = VenueDataSource.COMMUNITY
        }
      }
    }
    
    // Step 3: Apply time modifiers
    const now = new Date()
    basePulse = this.calculator.applyTimeModifiers(basePulse, now.getHours(), now.getDay())
    
    // Cap values
    const finalPulse = Math.min(10, Math.max(0, basePulse))
    
    return {
      value: Math.round(finalPulse * 10) / 10,
      confidence,
      dataSource,
      lastUpdated: new Date(),
      breakdown: {
        googleBusy,
        communityReports: communityData.dataPoints
      }
    }
  }
  
  /**
   * Get venue metrics for Spree venues
   */
  private async getVenueMetrics(venueId: number): Promise<VenueMetrics> {
    const now = new Date()
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000)
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000)
    
    // Get check-ins
    const { data: checkIns } = await supabase
      .from('checkins')
      .select('id, created_at, checked_out_at')
      .eq('venue_id', venueId)
      .gte('created_at', twoHoursAgo.toISOString())
    
    // Calculate check-in metrics
    const activeCheckIns = checkIns?.filter(c => !c.checked_out_at).length || 0
    const checkInsLast30Min = checkIns?.filter(c => 
      new Date(c.created_at) >= thirtyMinAgo
    ).length || 0
    const checkInsLastHour = checkIns?.filter(c => 
      new Date(c.created_at) >= oneHourAgo
    ).length || 0
    const previousHour = checkIns?.filter(c => 
      new Date(c.created_at) < oneHourAgo
    ).length || 0
    
    // Determine trend
    let checkInTrend: VenueMetrics['checkInTrend'] = 'stable'
    if (checkInsLast30Min > checkInsLastHour * 0.6) checkInTrend = 'surging'
    else if (checkInsLastHour > previousHour * 1.2) checkInTrend = 'increasing'
    else if (checkInsLastHour < previousHour * 0.8) checkInTrend = 'decreasing'
    
    // Get wait time
    const { data: statusLog } = await supabase
      .from('venue_status_logs')
      .select('line_time_minutes')
      .eq('venue_id', venueId)
      .gte('created_at', oneHourAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    
    // Get vibe data
    const { data: ratings } = await supabase
      .from('venue_ratings')
      .select('vibe_check')
      .eq('venue_id', venueId)
      .gte('created_at', oneHourAgo.toISOString())
    
    // Calculate sentiment
    let recentSentiment = 0
    if (ratings && ratings.length > 0) {
      const sentimentMap: Record<string, number> = {
        fire: 1,
        good: 0.5,
        mid: -0.5,
        dead: -1
      }
      
      recentSentiment = ratings.reduce((sum, r) => 
        sum + (sentimentMap[r.vibe_check || 'mid'] || 0), 0
      ) / ratings.length
    }
    
    // Get vibe photos count
    const { count: vibePhotosCount } = await supabase
      .from('vibe_photos')
      .select('*', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .eq('status', 'approved')
      .gte('created_at', oneHourAgo.toISOString())
    
    // Check for events
    const { data: events } = await supabase
      .from('events')
      .select('id')
      .eq('venue_id', venueId)
      .gte('starts_at', now.toISOString())
      .lte('starts_at', new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString())
    
    return {
      venueId,
      activeCheckIns,
      checkInsLast30Min,
      checkInsLastHour,
      checkInTrend,
      reportedWaitTime: statusLog?.line_time_minutes || null,
      recentRatings: ratings?.length || 0,
      recentSentiment,
      vibePhotosCount: vibePhotosCount || 0,
      dayOfWeek: now.getDay(),
      hourOfDay: now.getHours(),
      isSpecialEvent: (events?.length || 0) > 0
    }
  }
  
  /**
   * Get venue from database
   */
  private async getVenue(venueId: number): Promise<VenueRecord | null> {
    const { data } = await supabase
      .from('venues')
      .select('*')
      .eq('id', venueId)
      .single()
    
    return data
  }
  
  /**
   * Log calculation for analytics
   */
  private async logCalculation(
    venueId: number, 
    pulse: PulseData, 
    metrics?: VenueMetrics
  ) {
    await supabase
      .from('pulse_calculations_log')
      .insert({
        venue_id: venueId,
        calculated_pulse: pulse.value,
        factors: {
          data_source: pulse.dataSource,
          confidence: pulse.confidence,
          ...metrics
        }
      })
  }
  
  /**
   * Get default pulse when calculation fails
   */
  private getDefaultPulse(): PulseData {
    return {
      value: 5.0,
      confidence: 0.3,
      dataSource: VenueDataSource.ESTIMATED,
      lastUpdated: new Date()
    }
  }
}

/**
 * Batch update service
 */
export class PulseBatchUpdateService {
  private engine: PulseEngine
  
  constructor() {
    this.engine = new PulseEngine()
  }
  
  /**
   * Update all active venues
   */
  async updateAllVenues(): Promise<{
    total: number
    updated: number
    failed: number
    hotVenues: Array<{id: number, name: string, pulse: number}>
  }> {
    console.log('🔄 Starting batch pulse update...')
    
    // Get all active venues
    const { data: venues } = await supabase
      .from('venues')
      .select('id, name, spree_onboarded')
      .eq('is_active', true)
      .order('spree_onboarded', { ascending: false }) // Partners first
    
    if (!venues || venues.length === 0) {
      console.log('No venues to update')
      return { total: 0, updated: 0, failed: 0, hotVenues: [] }
    }
    
    console.log(`Found ${venues.length} venues to update`)
    
    // Process venues in batches
    const results = []
    const batchSize = 10
    
    for (let i = 0; i < venues.length; i += batchSize) {
      const batch = venues.slice(i, i + batchSize)
      const batchResults = await Promise.all(
        batch.map(async (venue) => {
          try {
            const pulse = await this.engine.calculatePulse(venue.id)
            
            // Update database
            await supabase
              .from('venues')
              .update({
                pulse: pulse.value,
                pulse_confidence: pulse.confidence,
                pulse_data_source: pulse.dataSource,
                pulse_updated_at: pulse.lastUpdated
              })
              .eq('id', venue.id)
            
            // Log to history
            await supabase
              .from('pulse_history')
              .insert({
                venue_id: venue.id,
                pulse_value: pulse.value,
                confidence: pulse.confidence,
                data_sources: [pulse.dataSource]
              })
            
            return {
              success: true,
              venueId: venue.id,
              name: venue.name,
              pulse: pulse.value,
              dataSource: pulse.dataSource
            }
          } catch (error) {
            console.error(`Failed to update ${venue.name}:`, error)
            return { 
              success: false, 
              venueId: venue.id,
              name: venue.name,
              pulse: 0,
              dataSource: 'estimated' as const
            }
          }
        })
      )
      
      results.push(...batchResults)
      
      // Log progress
      console.log(`Progress: ${Math.min(i + batchSize, venues.length)}/${venues.length}`)
    }
    
    // Calculate stats
    const updated = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length
    
    // Find hot venues
    const hotVenues = results
      .filter(r => r.success && r.pulse >= 7)
      .map(r => ({
        id: r.venueId,
        name: r.name,
        pulse: r.pulse
      }))
      .sort((a, b) => b.pulse - a.pulse)
    
    console.log('✅ Batch update complete')
    console.log(`Updated: ${updated}, Failed: ${failed}`)
    
    if (hotVenues.length > 0) {
      console.log('\n🔥 Hot venues:')
      hotVenues.forEach(v => {
        console.log(`   ${v.pulse.toFixed(1)} - ${v.name}`)
      })
    }
    
    return {
      total: venues.length,
      updated,
      failed,
      hotVenues
    }
  }
  
  /**
   * Update single venue (for real-time triggers)
   */
  async updateVenue(venueId: number): Promise<PulseData> {
    const pulse = await this.engine.calculatePulse(venueId)
    
    // Update database
    await supabase
      .from('venues')
      .update({
        pulse: pulse.value,
        pulse_confidence: pulse.confidence,
        pulse_data_source: pulse.dataSource,
        pulse_updated_at: pulse.lastUpdated
      })
      .eq('id', venueId)
    
    return pulse
  }
}
