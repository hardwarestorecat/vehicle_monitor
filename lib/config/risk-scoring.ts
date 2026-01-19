export const RISK_SCORING = {
  // Alert Threshold
  alertThreshold: 50,

  // Point-Based Scoring
  points: {
    faceMasks: 30,
    suv: 30,
    tacticalGear: 100,
    knownSuspicious: 80,
    confirmedIce: 100,
    outOfStateAdjacent: 20,      // Adjacent states to MN
    outOfStateDistant: 40,       // Non-adjacent states
    heavyTint: 20,
    multipleOccupants: 15,
    missingPlates: 50,
  },

  // Automatic Actions (bypass scoring)
  automaticActions: {
    // Auto-alert to main group (confirmed ICE)
    tacticalGear: true,
    knownSuspicious: true,

    // Mark as "Confirmed ICE" when detected
    tacticalGearMarkAsIce: true,
  },

  // Highly Suspected ICE Criteria (ALL must be true)
  highlySuspectedCriteria: {
    multipleOccupants: true,      // 2+ people
    faceMasks: true,              // Face masks/gators
    heavyTint: true,              // Tinted windows
    suvOrNoPlates: true,          // Large SUV OR no license plates
  },
} as const;

export type VehicleClassification = {
  vehicleType: string;
  tintLevel: 'none' | 'light' | 'moderate' | 'heavy';
  occupantCount: number;
  hasFaceMasks: boolean;
  hasTacticalGear: boolean;
  confidence: number;
};

export type RiskScoreResult = {
  riskScore: number;
  breakdown: { [key: string]: number };
  action: 'auto_alert_main' | 'auto_alert_suspected' | 'alert_if_threshold' | 'no_alert';
  iceStatus?: 'Confirmed ICE' | 'Highly suspected ICE';
  reasoning: string;
};
