// lib/pulse/index.ts

// Core exports
export { PulseEngine, PulseBatchUpdateService } from './engine'
export { PulseCalculator } from './calculations'
export { CommunityDataService } from './community'

// Types
export * from './types'

// Services
export { GoogleBusynessService } from './services/google-service'

// Main API for the app
import { PulseEngine, PulseBatchUpdateService } from './engine'
import { CommunityDataService } from './community'

// Singleton instances
const pulseEngine = new PulseEngine()
const batchService = new PulseBatchUpdateService()
const communityService = new CommunityDataService()

/**
 * Main Pulse API
 */
export const Pulse = {
  /**
   * Calculate pulse for a single venue
   */
  async calculate(venueId: number) {
    return pulseEngine.calculatePulse(venueId)
  },
  
  /**
   * Update all venues (batch job)
   */
  async updateAll() {
    return batchService.updateAllVenues()
  },
  
  /**
   * Update single venue immediately
   */
  async updateVenue(venueId: number) {
    return batchService.updateVenue(venueId)
  },
  
  /**
   * Submit community vibe report
   */
  async submitVibeReport(report: Parameters<typeof communityService.submitVibeReport>[0]) {
    return communityService.submitVibeReport(report)
  },
  
  /**
   * Submit anonymous ping
   */
  async submitPing(ping: Parameters<typeof communityService.submitAnonymousPing>[0]) {
    return communityService.submitAnonymousPing(ping)
  },
  
  /**
   * Get community consensus
   */
  async getCommunityConsensus(venueId: number, minutesBack?: number) {
    return communityService.getConsensus(venueId, minutesBack)
  }
}

// Export for backward compatibility if needed
export default Pulse
