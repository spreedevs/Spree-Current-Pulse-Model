// lib/pulse/community.ts

import { supabase } from '@/lib/supabase'
import { 
  QuickVibeReport, 
  AnonymousPing, 
  CommunityConsensus 
} from '@/lib/pulse/types'

export class CommunityDataService {
  
  /**
   * Submit a vibe report from a user
   */
  async submitVibeReport(report: QuickVibeReport): Promise<void> {
    // Check rate limiting (1 per venue per hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    
    const { data: existing } = await supabase
      .from('community_vibe_reports')
      .select('id')
      .eq('venue_id', report.venue_id)
      .eq('user_id', report.user_id)
      .gte('created_at', oneHourAgo.toISOString())
      .single()
    
    if (existing) {
      throw new Error('You already reported this venue recently')
    }
    
    // Submit report
    const { error } = await supabase
      .from('community_vibe_reports')
      .insert({
        ...report,
        created_at: new Date().toISOString()
      })
    
    if (error) throw error
    
    // Award points
    await this.awardPoints(report.user_id, 5, 'vibe_report')
    
    // Trigger pulse update
    await this.queuePulseUpdate(report.venue_id)
  }
  
  /**
   * Submit anonymous "I'm here" ping
   */
  async submitAnonymousPing(ping: AnonymousPing): Promise<void> {
    // Rate limit: 1 per hour per device
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    
    const { data: existing } = await supabase
      .from('anonymous_pings')
      .select('id')
      .eq('venue_id', ping.venue_id)
      .eq('device_id', ping.device_id)
      .gte('created_at', oneHourAgo.toISOString())
      .single()
    
    if (existing) return // Silently ignore
    
    await supabase
      .from('anonymous_pings')
      .insert({
        ...ping,
        created_at: new Date().toISOString()
      })
  }
  
  /**
   * Get community consensus for a venue
   */
  async getConsensus(venueId: number, minutesBack: number = 60): Promise<CommunityConsensus> {
    const since = new Date(Date.now() - minutesBack * 60 * 1000)
    
    // Get vibe reports
    const { data: vibeReports } = await supabase
      .from('community_vibe_reports')
      .select('vibe_level, wait_time_minutes, crowd_estimate')
      .eq('venue_id', venueId)
      .gte('created_at', since.toISOString())
    
    // Get anonymous pings
    const { data: pings } = await supabase
      .from('anonymous_pings')
      .select('device_id')
      .eq('venue_id', venueId)
      .gte('created_at', since.toISOString())
    
    // Get social signals
    const { data: socialSignals } = await supabase
      .from('social_signals')
      .select('signal_type')
      .eq('venue_id', venueId)
      .gte('created_at', since.toISOString())
    
    // Aggregate vibe data
    const vibeScores: Record<string, number> = {
      dead: 0,
      chill: 0,
      busy: 0,
      packed: 0
    }
    
    let totalWaitTime = 0
    let waitTimeReports = 0
    
    vibeReports?.forEach(report => {
      if (report.vibe_level) {
        vibeScores[report.vibe_level]++
      }
      if (report.wait_time_minutes) {
        totalWaitTime += report.wait_time_minutes
        waitTimeReports++
      }
    })
    
    // Find consensus vibe
    const totalVibeReports = Object.values(vibeScores).reduce((a, b) => a + b, 0)
    let consensusVibe: string | null = null
    let maxVotes = 0
    
    Object.entries(vibeScores).forEach(([vibe, count]) => {
      if (count > maxVotes && count >= totalVibeReports * 0.3) { // Need 30% agreement
        maxVotes = count
        consensusVibe = vibe
      }
    })
    
    // Count unique devices
    const uniqueDevices = new Set(pings?.map(p => p.device_id) || []).size
    
    return {
      vibeReports: totalVibeReports,
      consensusVibe,
      vibeScores,
      averageWaitTime: waitTimeReports > 0 ? totalWaitTime / waitTimeReports : null,
      anonymousPings: pings?.length || 0,
      uniqueDevices,
      socialSignals: socialSignals?.length || 0,
      dataPoints: totalVibeReports + (pings?.length || 0) + (socialSignals?.length || 0)
    }
  }
  
  /**
   * Calculate how much community data should influence pulse
   */
  calculateInfluence(consensus: CommunityConsensus): {
    influence: number // 0-1 weight
    adjustment: number // -2 to +2 pulse adjustment
  } {
    // Not enough data
    if (consensus.dataPoints < 3) {
      return { influence: 0, adjustment: 0 }
    }
    
    // Calculate influence based on data quantity and recency
    let influence = Math.min(0.4, consensus.dataPoints / 20) // Max 40% influence
    
    // If we have strong consensus, increase influence
    if (consensus.consensusVibe && consensus.vibeReports >= 5) {
      influence = Math.min(0.6, influence + 0.2)
    }
    
    // Calculate adjustment based on vibe
    let adjustment = 0
    
    if (consensus.consensusVibe === 'packed') adjustment = 2
    else if (consensus.consensusVibe === 'busy') adjustment = 1
    else if (consensus.consensusVibe === 'chill') adjustment = 0
    else if (consensus.consensusVibe === 'dead') adjustment = -2
    
    // Wait time adjustment
    if (consensus.averageWaitTime) {
      if (consensus.averageWaitTime >= 30) adjustment += 1
      else if (consensus.averageWaitTime >= 15) adjustment += 0.5
    }
    
    // Activity signals
    if (consensus.uniqueDevices >= 20) adjustment += 0.5
    if (consensus.socialSignals >= 5) adjustment += 0.3
    
    // Cap adjustment
    adjustment = Math.max(-2, Math.min(2, adjustment))
    
    return { influence, adjustment }
  }
  
  /**
   * Award points for community contribution
   */
  private async awardPoints(userId: string, points: number, reason: string) {
    await supabase
      .from('user_points')
      .insert({
        user_id: userId,
        points,
        source_type: 'community',
        timestamp: new Date().toISOString()
      })
  }
  
  /**
   * Queue venue for pulse update
   */
  private async queuePulseUpdate(venueId: number) {
    // You could implement a queue system here
    // For now, we'll just log it
    console.log(`Venue ${venueId} queued for pulse update`)
  }
}

// Database tables needed:
export const COMMUNITY_TABLES_SQL = `
-- Community vibe reports
CREATE TABLE IF NOT EXISTS community_vibe_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id INTEGER REFERENCES venues(id) NOT NULL,
  user_id UUID REFERENCES users(id) NOT NULL,
  vibe_level TEXT CHECK (vibe_level IN ('dead', 'chill', 'busy', 'packed')),
  wait_time_minutes INTEGER CHECK (wait_time_minutes >= 0 AND wait_time_minutes <= 180),
  crowd_estimate TEXT CHECK (crowd_estimate IN ('0%', '25%', '50%', '75%', '100%')),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Anonymous pings
CREATE TABLE IF NOT EXISTS anonymous_pings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id INTEGER REFERENCES venues(id) NOT NULL,
  device_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Social signals (for future use)
CREATE TABLE IF NOT EXISTS social_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id INTEGER REFERENCES venues(id) NOT NULL,
  signal_type TEXT NOT NULL,
  metadata JSONB,
  confidence DECIMAL(3,2) DEFAULT 0.5,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_vibe_reports_venue_time ON community_vibe_reports(venue_id, created_at DESC);
CREATE INDEX idx_pings_venue_time ON anonymous_pings(venue_id, created_at DESC);
CREATE INDEX idx_social_venue_time ON social_signals(venue_id, created_at DESC);

-- Add new columns to venues table
ALTER TABLE venues 
ADD COLUMN IF NOT EXISTS pulse_confidence DECIMAL(3,2) DEFAULT 0.5,
ADD COLUMN IF NOT EXISTS pulse_data_source TEXT DEFAULT 'estimated',
ADD COLUMN IF NOT EXISTS pulse_updated_at TIMESTAMP DEFAULT NOW();
`
