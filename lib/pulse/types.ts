// lib/pulse/types.ts

// Venue types
export enum VenueDataSource {
  SPREE = 'spree',           // Full Spree integration
  COMMUNITY = 'community',   // Community reports
  GOOGLE = 'google',         // Google data only
  ESTIMATED = 'estimated'    // No data available
}

// Pulse data structure
export interface PulseData {
  value: number              // 0-10 scale
  confidence: number         // 0-1 confidence score
  dataSource: VenueDataSource
  lastUpdated: Date
  breakdown?: PulseBreakdown
}

export interface PulseBreakdown {
  checkIns?: number
  googleBusy?: number
  communityReports?: number
  waitTime?: number
  vibeScore?: number
}

// Community data types
export interface QuickVibeReport {
  venue_id: number
  user_id: string
  vibe_level: 'dead' | 'chill' | 'busy' | 'packed'
  wait_time_minutes?: number
  crowd_estimate?: '0%' | '25%' | '50%' | '75%' | '100%'
  created_at?: Date
}

export interface AnonymousPing {
  venue_id: number
  device_id: string
  created_at?: Date
}

export interface CommunityConsensus {
  vibeReports: number
  consensusVibe: string | null
  vibeScores: Record<string, number>
  averageWaitTime: number | null
  anonymousPings: number
  uniqueDevices: number
  socialSignals: number
  dataPoints: number
}

// Venue metrics
export interface VenueMetrics {
  venueId: number
  
  // Check-in data
  activeCheckIns: number
  checkInsLast30Min: number
  checkInsLastHour: number
  checkInTrend: 'surging' | 'increasing' | 'stable' | 'decreasing'
  
  // Wait times
  reportedWaitTime: number | null
  
  // Ratings & vibes
  recentRatings: number
  recentSentiment: number  // -1 to 1
  vibePhotosCount: number
  
  // Context
  dayOfWeek: number
  hourOfDay: number
  isSpecialEvent: boolean
}

// Google data
export interface GoogleBusynessData {
  currentBusyness: number    // 0-100
  usualBusyness: number      // 0-100 for this hour
  relativeLevel: 'low' | 'below_average' | 'average' | 'above_average' | 'high'
  trend: 'decreasing' | 'stable' | 'increasing'
  lastUpdated: Date
  confidence: number
}

// Database schemas
export interface VenueRecord {
  id: number
  name: string
  google_place_id?: string
  spree_onboarded: boolean
  pulse: number
  pulse_confidence?: number
  pulse_data_source?: string
  pulse_updated_at?: Date
  capacity?: number
  venue_type?: string
  lat?: number
  lng?: number
}
