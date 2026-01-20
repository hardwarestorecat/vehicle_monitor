import { VehicleAnalysis, RiskAssessment, IceLookupResult } from '../../shared/types';
import { RISK_SCORING } from '../../../lib/config/risk-scoring';

export class RiskScorer {
  private homeState: string;
  private adjacentStates: string[];

  constructor(homeState: string, adjacentStates: string[]) {
    this.homeState = homeState;
    this.adjacentStates = adjacentStates;
  }

  /**
   * Calculate risk score and determine actions
   */
  calculateRisk(
    vehicleAnalysis: VehicleAnalysis,
    plateState: string | undefined,
    iceLookup: IceLookupResult,
    isKnownSuspicious: boolean
  ): RiskAssessment {
    const breakdown: { [key: string]: number } = {};

    // PRIORITY 1: Confirmed ICE from database
    if (iceLookup.found && iceLookup.status === 'Confirmed ICE') {
      breakdown['Confirmed ICE (database)'] = RISK_SCORING.points.confirmedIce;
      return {
        riskScore: 100,
        breakdown,
        action: 'auto_alert_main',
        iceStatus: 'Confirmed ICE',
        reasoning: 'License plate found in confirmed ICE database',
      };
    }

    // PRIORITY 2: Highly suspected ICE from database
    if (iceLookup.found && iceLookup.status === 'Highly suspected ICE') {
      breakdown['Highly suspected ICE (database)'] = RISK_SCORING.points.confirmedIce;
      return {
        riskScore: 100,
        breakdown,
        action: 'auto_alert_suspected',
        iceStatus: 'Highly suspected ICE',
        reasoning: 'License plate found in highly suspected ICE database',
      };
    }

    // PRIORITY 3: Tactical gear detected (AUTOMATIC ALERT)
    if (vehicleAnalysis.hasTacticalGear) {
      breakdown['Tactical gear detected'] = RISK_SCORING.points.tacticalGear;
      return {
        riskScore: 100,
        breakdown,
        action: 'auto_alert_main',
        iceStatus: 'Confirmed ICE',
        reasoning: 'Tactical gear detected - automatic ICE classification',
      };
    }

    // PRIORITY 4: Known suspicious vehicle (AUTOMATIC ALERT)
    if (isKnownSuspicious) {
      breakdown['Known suspicious vehicle'] = RISK_SCORING.points.knownSuspicious;
      return {
        riskScore: 100,
        breakdown,
        action: 'auto_alert_main',
        reasoning: 'Vehicle previously marked as suspicious',
      };
    }

    // PRIORITY 5: Highly Suspected ICE Criteria (ALL must be true)
    const meetsHighlySuspectedCriteria = this.checkHighlySuspectedCriteria(vehicleAnalysis, plateState);
    if (meetsHighlySuspectedCriteria.meets) {
      // Add points for all criteria
      Object.entries(meetsHighlySuspectedCriteria.breakdown).forEach(([key, value]) => {
        breakdown[key] = value;
      });

      const totalScore = Object.values(breakdown).reduce((sum, val) => sum + val, 0);

      return {
        riskScore: totalScore,
        breakdown,
        action: 'auto_alert_suspected',
        iceStatus: 'Highly suspected ICE',
        reasoning: meetsHighlySuspectedCriteria.reasoning,
      };
    }

    // STANDARD RISK SCORING (point-based)
    let riskScore = 0;

    // Face masks/gators
    if (vehicleAnalysis.hasFaceMasks) {
      const points = RISK_SCORING.points.faceMasks;
      breakdown['Face masks/gators detected'] = points;
      riskScore += points;
    }

    // SUV
    if (vehicleAnalysis.vehicleType.toLowerCase() === 'suv') {
      const points = RISK_SCORING.points.suv;
      breakdown['SUV vehicle type'] = points;
      riskScore += points;
    }

    // Out-of-state plates
    if (plateState && plateState !== this.homeState) {
      const isAdjacent = this.adjacentStates.includes(plateState);
      const points = isAdjacent
        ? RISK_SCORING.points.outOfStateAdjacent
        : RISK_SCORING.points.outOfStateDistant;
      const label = isAdjacent
        ? `Out-of-state (adjacent: ${plateState})`
        : `Out-of-state (distant: ${plateState})`;
      breakdown[label] = points;
      riskScore += points;
    }

    // Heavy window tint
    if (vehicleAnalysis.tintLevel === 'heavy') {
      const points = RISK_SCORING.points.heavyTint;
      breakdown['Heavy window tint'] = points;
      riskScore += points;
    }

    // Multiple occupants (not automatic, just adds points)
    if (vehicleAnalysis.occupantCount >= 2) {
      const points = RISK_SCORING.points.multipleOccupants;
      breakdown['Multiple occupants'] = points;
      riskScore += points;
    }

    // Determine action based on score
    const action =
      riskScore >= RISK_SCORING.alertThreshold ? 'alert_if_threshold' : 'no_alert';

    const reasoning = this.buildReasoning(breakdown, riskScore);

    return {
      riskScore,
      breakdown,
      action,
      reasoning,
    };
  }

  /**
   * Check if vehicle meets "Highly Suspected ICE" criteria
   */
  private checkHighlySuspectedCriteria(
    vehicleAnalysis: VehicleAnalysis,
    plateState: string | undefined
  ): { meets: boolean; breakdown: { [key: string]: number }; reasoning: string } {
    const criteria = RISK_SCORING.highlySuspectedCriteria;
    const breakdown: { [key: string]: number } = {};
    const reasons: string[] = [];

    // Check all criteria
    const hasMultipleOccupants = vehicleAnalysis.occupantCount >= 2;
    const hasFaceMasks = vehicleAnalysis.hasFaceMasks;
    const hasHeavyTint = vehicleAnalysis.tintLevel === 'heavy';
    const isSuvOrNoPlates =
      vehicleAnalysis.vehicleType.toLowerCase() === 'suv' || !plateState;

    if (!hasMultipleOccupants || !hasFaceMasks || !hasHeavyTint || !isSuvOrNoPlates) {
      return { meets: false, breakdown: {}, reasoning: '' };
    }

    // All criteria met - add points
    breakdown['Multiple occupants (2+)'] = RISK_SCORING.points.multipleOccupants;
    breakdown['Face masks/gators'] = RISK_SCORING.points.faceMasks;
    breakdown['Heavy window tint'] = RISK_SCORING.points.heavyTint;

    if (vehicleAnalysis.vehicleType.toLowerCase() === 'suv') {
      breakdown['Large SUV'] = RISK_SCORING.points.suv;
      reasons.push('Large SUV');
    } else if (!plateState) {
      breakdown['No license plates'] = RISK_SCORING.points.missingPlates;
      reasons.push('No license plates');
    }

    reasons.unshift(
      'Multiple occupants (2+)',
      'Face masks/gators present',
      'Heavy window tint'
    );

    return {
      meets: true,
      breakdown,
      reasoning: `Highly suspected ICE: ${reasons.join(', ')}`,
    };
  }

  /**
   * Build reasoning text
   */
  private buildReasoning(breakdown: { [key: string]: number }, totalScore: number): string {
    if (Object.keys(breakdown).length === 0) {
      return 'No risk factors detected';
    }

    const factors = Object.entries(breakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([factor, points]) => `${factor} (+${points})`)
      .join(', ');

    return `Risk score: ${totalScore}. Factors: ${factors}`;
  }
}
