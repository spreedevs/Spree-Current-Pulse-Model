// lib/pulse/services/google-service.ts

import { supabase } from '@/lib/supabase'
import { GoogleBusynessData } from '../types'

export class GoogleBusynessService {
  private apiKey: string
  private cacheExpiry: number = 5 * 60 * 1000 // 5 minutes
  
  constructor() {
    this.apiKey = process.env.EXPO_PUBLIC_SERP_API_KEY || ''
  }
  
  /**
   * Get busyness data for a venue
   */
  async getBusyness(googlePlaceId: string): Promise<GoogleBusynessData | null> {
    try {
      // Check cache first
      const cached = await this.getCachedData(googlePlaceId)
      if (cached) {
        return cached
      }
      
      // Fetch fresh data
      const freshData = await this.fetchFromSerpAPI(googlePlaceId)
      
      // Cache it
      if (freshData) {
        await this.cacheData(googlePlaceId, freshData)
      }
      
      return freshData
    } catch (error) {
      console.error('Error fetching Google busyness:', error)
      return null
    }
  }
  
  /**
   * Fetch live data from SerpAPI
   */
  private async fetchFromSerpAPI(placeId: string): Promise<GoogleBusynessData | null> {
    if (!this.apiKey) {
      console.warn('No SERP_API_KEY configured')
      return null
    }
    
    const url = `https://serpapi.com/search.json?` +
      `engine=google_maps&` +
      `type=place&` +
      `data_id=${placeId}&` +
      `api_key=${this.apiKey}`
    
    try {
      const response = await fetch(url)
      const data = await response.json()
      
      if (data.error) {
        console.error('SerpAPI error:', data.error)
        return null
      }
      
      const placeInfo = data.place_results
      if (!placeInfo) {
        return null
      }
      
      // Extract busyness data
      const currentBusyness = placeInfo.current_popularity || 0
      const currentDay = new Date().toLocaleDateString('en-US', { weekday: 'long' })
      const currentHour = new Date().getHours()
      
      // Get usual busyness
      let usualBusyness = 50
      if (placeInfo.populartimes) {
        const todayData = placeInfo.populartimes.find(
          (day: any) => day.day === currentDay
        )
        if (todayData?.data?.[currentHour]) {
          usualBusyness = todayData.data[currentHour]
        }
      }
      
      // Determine trend
      const trend = this.calculateTrend(currentBusyness, usualBusyness)
      const relativeLevel = this.calculateRelativeLevel(currentBusyness, usualBusyness)
      
      return {
        currentBusyness,
        usualBusyness,
        relativeLevel,
        trend,
        lastUpdated: new Date(),
        confidence: currentBusyness > 0 ? 0.9 : 0.3
      }
    } catch (error) {
      console.error('Failed to fetch from SerpAPI:', error)
      return null
    }
  }
  
  /**
   * Calculate trend from current vs usual
   */
  private calculateTrend(
    current: number, 
    usual: number
  ): GoogleBusynessData['trend'] {
    const difference = current - usual
    if (difference > 10) return 'increasing'
    if (difference < -10) return 'decreasing'
    return 'stable'
  }
  
  /**
   * Calculate relative busyness level
   */
  private calculateRelativeLevel(
    current: number, 
    usual: number
  ): GoogleBusynessData['relativeLevel'] {
    const ratio = usual > 0 ? current / usual : 1
    
    if (ratio < 0.5) return 'low'
    if (ratio < 0.8) return 'below_average'
    if (ratio < 1.2) return 'average'
    if (ratio < 1.5) return 'above_average'
    return 'high'
  }
  
  /**
   * Get cached data
   */
  private async getCachedData(placeId: string): Promise<GoogleBusynessData | null> {
    const { data } = await supabase
      .from('google_busyness_cache')
      .select('busyness_data, fetched_at')
      .eq('google_place_id', placeId)
      .single()
    
    if (!data) return null
    
    // Check if cache is still valid
    const age = Date.now() - new Date(data.fetched_at).getTime()
    if (age > this.cacheExpiry) return null
    
    return data.busyness_data as GoogleBusynessData
  }
  
  /**
   * Cache busyness data
   */
  private async cacheData(placeId: string, data: GoogleBusynessData) {
    await supabase
      .from('google_busyness_cache')
      .upsert({
        google_place_id: placeId,
        busyness_data: data,
        fetched_at: new Date().toISOString()
      })
  }
}

// Create the cache table if it doesn't exist
export const GOOGLE_CACHE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS google_busyness_cache (
  google_place_id TEXT PRIMARY KEY,
  busyness_data JSONB NOT NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_google_cache_fetched ON google_busyness_cache(fetched_at);
`
