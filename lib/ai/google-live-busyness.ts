// lib/ai/google-live-busyness.ts

import { supabase } from '@/lib/supabase'

interface LiveBusynessData {
  currentBusyness: number // 0-100
  usualBusyness: number // 0-100 for this hour
  relativeLevel: 'low' | 'below_average' | 'average' | 'above_average' | 'high'
  trend: 'decreasing' | 'stable' | 'increasing'
  lastUpdated: Date
  confidence: number
}

export class GoogleLiveBusynessService {
  private serpApiKey: string
  private cacheExpiry: number = 5 * 60 * 1000 // 5 minutes
  
  constructor() {
    this.serpApiKey = process.env.EXPO_PUBLIC_SERP_API_KEY!
  }
  
  // Main method to get live busyness
  async getLiveBusyness(venueId: number): Promise<LiveBusynessData | null> {
    try {
      // Check cache first
      const cached = await this.getCachedBusyness(venueId)
      if (cached) {
        console.log('📦 Using cached Google data')
        return cached
      }
      
      // Get venue's Google Place ID
      const venue = await this.getVenueGoogleId(venueId)
      if (!venue?.google_place_id) {
        console.log(`No Google Place ID for venue ${venueId}`)
        return null
      }
      
      console.log(`🔍 Fetching live data for venue ${venueId} (${venue.name})`)
      
      // Fetch from SerpAPI (most reliable for live data)
      const liveData = await this.fetchFromSerpAPI(venue.google_place_id)
      
      // Cache the result
      await this.cacheBusynessData(venueId, liveData)
      
      // Log for ML training
      await this.logBusynessData(venueId, liveData)
      
      return liveData
    } catch (error) {
      console.error('Error fetching live busyness:', error)
      return null
    }
  }
  
  // Fetch using SerpAPI (paid but reliable)
  private async fetchFromSerpAPI(placeId: string): Promise<LiveBusynessData> {
    const url = `https://serpapi.com/search.json?` +
      `engine=google_maps&` +
      `type=place&` +
      `data_id=${placeId}&` + // Using data_id for better results
      `api_key=${this.serpApiKey}`
    
    console.log('🌐 Calling SerpAPI...')
    
    const response = await fetch(url)
    const data = await response.json()
    
    // Debug logging
    console.log('🔍 Google Place Details:', {
      title: data.place_results?.title,
      currentPopularity: data.place_results?.current_popularity,
      popularTimes: data.place_results?.populartimes ? 'Available' : 'Not available',
      liveBusy: data.place_results?.live_busy,
      spendingTime: data.place_results?.spending_time,
      userReviews: data.place_results?.user_reviews?.summary?.length || 0
    })
    
    const placeInfo = data.place_results
    
    // Extract live busyness info
    const currentBusyness = placeInfo?.current_popularity || 0
    const currentDay = new Date().toLocaleDateString('en-US', { weekday: 'long' })
    const currentHour = new Date().getHours()
    
    // Get usual busyness for this time
    let usualBusyness = 50 // default
    if (placeInfo?.populartimes) {
      const todayData = placeInfo.populartimes.find(
        (day: any) => day.day === currentDay
      )
      if (todayData?.data?.[currentHour]) {
        usualBusyness = todayData.data[currentHour]
      }
    }
    
    // Calculate trend
    const trend = this.calculateTrend(
      placeInfo?.current_popularity,
      usualBusyness
    )
    
    console.log('📊 Parsed data:', {
      currentBusyness,
      usualBusyness,
      trend,
      hasLiveData: currentBusyness > 0
    })
    
    return {
      currentBusyness,
      usualBusyness,
      relativeLevel: this.getBusynessLevel(currentBusyness, usualBusyness),
      trend,
      lastUpdated: new Date(),
      confidence: currentBusyness > 0 ? 0.9 : 0.3
    }
  }
  
  // Calculate trend from current vs expected
  private calculateTrend(current: number, usual: number): 'decreasing' | 'stable' | 'increasing' {
    if (!current || !usual) return 'stable'
    
    const difference = current - usual
    if (difference > 10) return 'increasing'
    if (difference < -10) return 'decreasing'
    return 'stable'
  }
  
  // Get relative busyness level
  private getBusynessLevel(current: number, usual: number): LiveBusynessData['relativeLevel'] {
    if (usual === 0) return 'average'
    
    const ratio = current / usual
    
    if (ratio < 0.5) return 'low'
    if (ratio < 0.8) return 'below_average'
    if (ratio < 1.2) return 'average'
    if (ratio < 1.5) return 'above_average'
    return 'high'
  }
  
  // Cache management
  private async getCachedBusyness(venueId: number): Promise<LiveBusynessData | null> {
    const { data } = await supabase
      .from('google_busyness_cache')
      .select('*')
      .eq('venue_id', venueId)
      .single()
    
    if (!data) return null
    
    // Check if cache is still valid
    const age = Date.now() - new Date(data.fetched_at).getTime()
    if (age > this.cacheExpiry) return null
    
    return data.busyness_data as LiveBusynessData
  }
  
  private async cacheBusynessData(venueId: number, data: LiveBusynessData) {
    await supabase
      .from('google_busyness_cache')
      .upsert({
        venue_id: venueId,
        busyness_data: data,
        fetched_at: new Date().toISOString()
      })
  }
  
  // Log for ML training
  private async logBusynessData(venueId: number, googleData: LiveBusynessData) {
    // Get our current pulse for comparison
    const { data: venueData } = await supabase
      .from('venues')
      .select('pulse')
      .eq('id', venueId)
      .single()
    
    await supabase
      .from('google_busyness_log')
      .insert({
        venue_id: venueId,
        google_busyness: googleData.currentBusyness,
        google_usual: googleData.usualBusyness,
        google_trend: googleData.trend,
        spree_pulse: venueData?.pulse || 0,
        timestamp: new Date().toISOString()
      })
  }
  
  // Get venue's Google Place ID
  private async getVenueGoogleId(venueId: number) {
    const { data } = await supabase
      .from('venues')
      .select('google_place_id, name, address')
      .eq('id', venueId)
      .single()
    
    return data
  }
}

// Integration with your Pulse AI
export class GoogleEnhancedPulse {
  private googleBusyness: GoogleLiveBusynessService
  
  constructor() {
    this.googleBusyness = new GoogleLiveBusynessService()
  }
  
  // Enhance pulse calculation with Google data
  async calculatePulseWithGoogle(
    venueId: number, 
    spreePulse: number,
    spreeFactors: any
  ): Promise<{
    finalPulse: number
    googleInfluence: number
    confidence: number
  }> {
    // Get Google live data
    const googleData = await this.googleBusyness.getLiveBusyness(venueId)
    
    if (!googleData || googleData.confidence < 0.5) {
      // No reliable Google data, use pure Spree pulse
      console.log('📊 No reliable Google data, using pure Spree pulse')
      return {
        finalPulse: spreePulse,
        googleInfluence: 0,
        confidence: 0.7
      }
    }
    
    console.log('✅ Got Google data, enhancing pulse...')
    
    // Calculate how much Google should influence the pulse
    const googleInfluence = this.calculateGoogleInfluence(
      googleData,
      spreeFactors
    )
    
    // Blend Spree and Google data
    const finalPulse = this.blendPulseScores(
      spreePulse,
      googleData,
      googleInfluence
    )
    
    console.log('🔄 Pulse enhancement:', {
      spreePulse: spreePulse.toFixed(1),
      googleInfluence: (googleInfluence * 100).toFixed(0) + '%',
      finalPulse: finalPulse.toFixed(1)
    })
    
    return {
      finalPulse,
      googleInfluence,
      confidence: this.calculateCombinedConfidence(spreeFactors, googleData)
    }
  }
  
  private calculateGoogleInfluence(
    googleData: LiveBusynessData,
    spreeFactors: any
  ): number {
    // Start with base influence
    let influence = 0.3 // 30% base weight
    
    // Adjust based on Spree data availability
    if (spreeFactors.activeCheckIns < 10) {
      // Low Spree data, trust Google more
      influence += 0.2
    } else if (spreeFactors.activeCheckIns > 50) {
      // High Spree data, trust our data more
      influence -= 0.1
    }
    
    // Adjust based on Google confidence
    influence *= googleData.confidence
    
    // Cap influence
    return Math.min(0.5, Math.max(0.1, influence))
  }
  
  private blendPulseScores(
    spreePulse: number,
    googleData: LiveBusynessData,
    googleInfluence: number
  ): number {
    // Convert Google's 0-100 to our 0-10 scale
    const googlePulse = this.convertGoogleToSpree(googleData.currentBusyness)
    
    // Weighted average
    const blendedPulse = (spreePulse * (1 - googleInfluence)) + 
                        (googlePulse * googleInfluence)
    
    // Apply trend adjustment
    let trendAdjustment = 0
    if (googleData.trend === 'increasing') trendAdjustment = 0.3
    else if (googleData.trend === 'decreasing') trendAdjustment = -0.3
    
    const finalPulse = blendedPulse + trendAdjustment
    
    return Math.min(10, Math.max(0, finalPulse))
  }
  
  private convertGoogleToSpree(googleBusyness: number): number {
    // Convert Google's 0-100 to Spree's 0-10
    // Non-linear conversion - nightlife venues rarely hit 100%
    
    if (googleBusyness >= 80) return 9 + (googleBusyness - 80) / 20
    if (googleBusyness >= 60) return 7 + (googleBusyness - 60) / 10
    if (googleBusyness >= 40) return 5 + (googleBusyness - 40) / 10
    if (googleBusyness >= 20) return 3 + (googleBusyness - 20) / 10
    return googleBusyness / 10
  }
  
  private calculateCombinedConfidence(
    spreeFactors: any,
    googleData: LiveBusynessData
  ): number {
    // Average confidence from both sources
    const spreeConfidence = Math.min(0.9, spreeFactors.activeCheckIns / 30)
    const googleConfidence = googleData.confidence
    
    // Weighted by data source reliability
    return (spreeConfidence * 0.6) + (googleConfidence * 0.4)
  }
}
