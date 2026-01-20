import { ProcessingResult } from '../../shared/types';

export interface AlertMessage {
  groupType: 'main' | 'suspected';
  alertType: 'CONFIRMED_ICE' | 'SUSPECTED_ICE' | 'HIGH_RISK';
  subject: string;
  body: string;
  plateNumber: string;
  imageS3Key: string;
}

export class AlertService {
  /**
   * Format and send alert based on sighting type
   */
  async sendAlert(result: ProcessingResult): Promise<void> {
    const message = this.formatAlert(result);

    // TODO: Actually send via Signal API when deployed
    // For now, log what would be sent
    console.log('='.repeat(80));
    console.log(`📱 SIGNAL ALERT - ${message.alertType}`);
    console.log('='.repeat(80));
    console.log(`Group: ${message.groupType}`);
    console.log(`Subject: ${message.subject}`);
    console.log('');
    console.log(message.body);
    console.log('');
    console.log(`Image: ${message.imageS3Key}`);
    console.log('='.repeat(80));

    // TODO: Uncomment when Signal API is deployed
    // await this.callSignalApi(message);
  }

  /**
   * Format alert message based on risk assessment
   */
  private formatAlert(result: ProcessingResult): AlertMessage {
    const { plateNumber, plateState, riskAssessment, imageMetadata } = result;

    // Determine alert type and formatting
    let alertType: 'CONFIRMED_ICE' | 'SUSPECTED_ICE' | 'HIGH_RISK';
    let emoji: string;
    let subject: string;
    let body: string;

    if (riskAssessment.iceStatus === 'Confirmed ICE') {
      // 🚨 RED ALERT - Confirmed ICE
      alertType = 'CONFIRMED_ICE';
      emoji = '🚨';
      subject = `${emoji} CONFIRMED ICE VEHICLE DETECTED`;
      body = this.formatConfirmedIceAlert(result);
    } else if (riskAssessment.iceStatus === 'Highly suspected ICE') {
      // ⚠️ YELLOW WARNING - Suspected ICE
      alertType = 'SUSPECTED_ICE';
      emoji = '⚠️';
      subject = `${emoji} SUSPECTED ICE VEHICLE`;
      body = this.formatSuspectedIceAlert(result);
    } else {
      // 📊 BLUE INFO - High Risk
      alertType = 'HIGH_RISK';
      emoji = '📊';
      subject = `${emoji} HIGH RISK VEHICLE (Score: ${riskAssessment.riskScore})`;
      body = this.formatHighRiskAlert(result);
    }

    return {
      groupType: result.signalGroupType || 'main',
      alertType,
      subject,
      body,
      plateNumber,
      imageS3Key: imageMetadata.s3Key,
    };
  }

  /**
   * Format message for confirmed ICE alerts
   */
  private formatConfirmedIceAlert(result: ProcessingResult): string {
    const { plateNumber, plateState, riskAssessment, imageMetadata } = result;

    return `
🚨 CONFIRMED ICE VEHICLE DETECTED 🚨

License Plate: ${plateNumber}${plateState ? ` (${plateState})` : ''}
Status: CONFIRMED ICE

Location: ${imageMetadata.location}
Cross Street: ${imageMetadata.crossStreet}
Direction: ${imageMetadata.direction}
Time: ${new Date(imageMetadata.timestamp).toLocaleString('en-US', { timeZone: 'America/Chicago' })}

Reason: ${riskAssessment.reasoning}

⚠️ IMMEDIATE ACTION REQUIRED ⚠️
`.trim();
  }

  /**
   * Format message for suspected ICE alerts
   */
  private formatSuspectedIceAlert(result: ProcessingResult): string {
    const { plateNumber, plateState, riskAssessment, imageMetadata, vehicleAnalysis } = result;

    const factors: string[] = [];
    if (vehicleAnalysis?.occupantCount && vehicleAnalysis.occupantCount >= 2) {
      factors.push(`• ${vehicleAnalysis.occupantCount} occupants`);
    }
    if (vehicleAnalysis?.hasFaceMasks) {
      factors.push('• Face masks/gators present');
    }
    if (vehicleAnalysis?.tintLevel === 'heavy') {
      factors.push('• Heavy window tint');
    }
    if (vehicleAnalysis?.vehicleType === 'suv') {
      factors.push('• Large SUV');
    }
    if (vehicleAnalysis?.hasTacticalGear) {
      factors.push('• Tactical gear visible');
    }

    return `
⚠️ SUSPECTED ICE VEHICLE ⚠️

License Plate: ${plateNumber}${plateState ? ` (${plateState})` : ''}
Status: HIGHLY SUSPECTED

Location: ${imageMetadata.location}
Cross Street: ${imageMetadata.crossStreet}
Direction: ${imageMetadata.direction}
Time: ${new Date(imageMetadata.timestamp).toLocaleString('en-US', { timeZone: 'America/Chicago' })}

Suspicious Factors:
${factors.join('\n')}

Risk Score: ${riskAssessment.riskScore}/100

Reason: ${riskAssessment.reasoning}
`.trim();
  }

  /**
   * Format message for high risk alerts
   */
  private formatHighRiskAlert(result: ProcessingResult): string {
    const { plateNumber, plateState, riskAssessment, imageMetadata, vehicleAnalysis } = result;

    const breakdown = Object.entries(riskAssessment.breakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([factor, points]) => `• ${factor}: +${points}`)
      .join('\n');

    return `
📊 HIGH RISK VEHICLE DETECTED

License Plate: ${plateNumber}${plateState ? ` (${plateState})` : ''}
Risk Score: ${riskAssessment.riskScore}/100

Location: ${imageMetadata.location}
Cross Street: ${imageMetadata.crossStreet}
Direction: ${imageMetadata.direction}
Time: ${new Date(imageMetadata.timestamp).toLocaleString('en-US', { timeZone: 'America/Chicago' })}

Vehicle Details:
• Type: ${vehicleAnalysis?.vehicleType || 'unknown'}
• Tint: ${vehicleAnalysis?.tintLevel || 'none'}
• Occupants: ${vehicleAnalysis?.occupantCount || 0}
${vehicleAnalysis?.hasFaceMasks ? '• Face masks: YES' : ''}
${vehicleAnalysis?.hasTacticalGear ? '• Tactical gear: YES' : ''}

Risk Factors:
${breakdown}

Reasoning: ${riskAssessment.reasoning}
`.trim();
  }

  /**
   * TODO: Call actual Signal API
   * This will be implemented when Signal infrastructure is deployed
   */
  private async callSignalApi(message: AlertMessage): Promise<void> {
    // Implementation will call the Signal REST API endpoint
    // POST /v2/send with message and image attachment
    throw new Error('Signal API not yet deployed');
  }
}
