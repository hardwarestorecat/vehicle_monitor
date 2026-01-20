import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ConfirmedSighting,
  StandardSighting,
  Vehicle,
  ProcessingResult,
} from '../../shared/types';

export class DynamoDBService {
  private docClient: DynamoDBDocumentClient;
  private confirmedSightingsTable: string;
  private sightingsTable: string;
  private vehiclesTable: string;
  private confirmedTtlDays: number;
  private sightingsTtlDays: number;

  constructor(
    confirmedSightingsTable: string,
    sightingsTable: string,
    vehiclesTable: string,
    confirmedTtlDays: number,
    sightingsTtlDays: number
  ) {
    const client = new DynamoDBClient({});
    this.docClient = DynamoDBDocumentClient.from(client);
    this.confirmedSightingsTable = confirmedSightingsTable;
    this.sightingsTable = sightingsTable;
    this.vehiclesTable = vehiclesTable;
    this.confirmedTtlDays = confirmedTtlDays;
    this.sightingsTtlDays = sightingsTtlDays;
  }

  /**
   * Save confirmed ICE sighting
   */
  async saveConfirmedSighting(result: ProcessingResult): Promise<void> {
    console.log('Saving confirmed ICE sighting to DynamoDB...');

    const ttl = Math.floor(Date.now() / 1000) + this.confirmedTtlDays * 24 * 60 * 60;

    // Determine ICE reason
    let iceReason: 'known_database' | 'tactical_gear' | 'multiple_conditions' = 'known_database';
    if (result.riskAssessment.reasoning.includes('Tactical gear')) {
      iceReason = 'tactical_gear';
    } else if (result.iceStatus === 'Highly suspected ICE') {
      iceReason = 'multiple_conditions';
    }

    const item: ConfirmedSighting = {
      plateNumber: result.plateNumber,
      timestamp: result.timestamp,
      sightingId: result.sightingId,
      plateState: result.plateState,
      cameraId: result.imageMetadata.cameraId,
      location: result.imageMetadata.location,
      crossStreet: result.imageMetadata.crossStreet,
      direction: result.imageMetadata.direction,
      imageS3Key: result.imageMetadata.s3Key,
      vehicleMake: result.vehicleAnalysis?.make || 'Unknown',
      vehicleModel: result.vehicleAnalysis?.model || 'Unknown',
      vehicleYear: result.vehicleAnalysis?.year || null,
      vehicleColor: result.vehicleAnalysis?.color || 'Unknown',
      vehicleType: result.vehicleAnalysis?.vehicleType || 'unknown',
      iceStatus: result.iceStatus!,
      textractConfidence: result.vehicleAnalysis?.confidence || 0,
      iceReason,
      alertSent: result.alertSent,
      signalGroupType: result.signalGroupType!,
      ttl,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.confirmedSightingsTable,
        Item: item,
      })
    );

    console.log(`Confirmed sighting saved: ${result.plateNumber} at ${result.timestamp}`);
  }

  /**
   * Save standard sighting (non-ICE with full analysis)
   */
  async saveStandardSighting(result: ProcessingResult): Promise<void> {
    console.log('Saving standard sighting to DynamoDB...');

    const ttl = Math.floor(Date.now() / 1000) + this.sightingsTtlDays * 24 * 60 * 60;

    const item: StandardSighting = {
      plateNumber: result.plateNumber,
      timestamp: result.timestamp,
      sightingId: result.sightingId,
      plateState: result.plateState,
      cameraId: result.imageMetadata.cameraId,
      location: result.imageMetadata.location,
      crossStreet: result.imageMetadata.crossStreet,
      direction: result.imageMetadata.direction,
      imageS3Key: result.imageMetadata.s3Key,
      vehicleMake: result.vehicleAnalysis?.make || 'Unknown',
      vehicleModel: result.vehicleAnalysis?.model || 'Unknown',
      vehicleYear: result.vehicleAnalysis?.year || null,
      vehicleColor: result.vehicleAnalysis?.color || 'Unknown',
      vehicleType: result.vehicleAnalysis?.vehicleType || 'unknown',
      tintLevel: result.vehicleAnalysis?.tintLevel || 'none',
      occupantCount: result.vehicleAnalysis?.occupantCount || 0,
      hasFaceMasks: result.vehicleAnalysis?.hasFaceMasks || false,
      hasTacticalGear: result.vehicleAnalysis?.hasTacticalGear || false,
      riskScore: result.riskAssessment.riskScore,
      alertSent: result.alertSent,
      rawTextractData: result.vehicleAnalysis?.rawBedrockData || {},
      rawBedrockData: result.vehicleAnalysis?.rawBedrockData || {},
      ttl,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.sightingsTable,
        Item: item,
      })
    );

    console.log(`Standard sighting saved: ${result.plateNumber} at ${result.timestamp}`);
  }

  /**
   * Get or create vehicle record
   */
  async getOrCreateVehicle(plateNumber: string, state?: string): Promise<Vehicle> {
    console.log(`Looking up vehicle: ${plateNumber}`);

    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.vehiclesTable,
        Key: { plateNumber },
      })
    );

    if (result.Item) {
      return result.Item as Vehicle;
    }

    // Create new vehicle record
    const now = new Date().toISOString();
    const vehicle: Vehicle = {
      plateNumber,
      platePrefix: plateNumber.substring(0, 3),
      state,
      isKnownSuspicious: false,
      suspicionLevel: 0,
      firstSeen: now,
      lastSeen: now,
      totalSightings: 0,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.vehiclesTable,
        Item: vehicle,
      })
    );

    console.log(`Created new vehicle record: ${plateNumber}`);
    return vehicle;
  }

  /**
   * Update vehicle record after sighting
   */
  async updateVehicleAfterSighting(
    plateNumber: string,
    riskScore: number,
    iceStatus?: string
  ): Promise<void> {
    console.log(`Updating vehicle record: ${plateNumber}`);

    const updates: any = {
      lastSeen: new Date().toISOString(),
      totalSightings: 1, // Will be incremented
    };

    // Mark as suspicious if high risk or confirmed ICE
    if (iceStatus === 'Confirmed ICE' || riskScore >= 80) {
      updates.isKnownSuspicious = true;
      updates.suspicionLevel = Math.max(riskScore, 80);
    }

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.vehiclesTable,
        Key: { plateNumber },
        UpdateExpression:
          'SET lastSeen = :lastSeen, totalSightings = if_not_exists(totalSightings, :zero) + :one' +
          (updates.isKnownSuspicious
            ? ', isKnownSuspicious = :suspicious, suspicionLevel = :level'
            : ''),
        ExpressionAttributeValues: {
          ':lastSeen': updates.lastSeen,
          ':zero': 0,
          ':one': 1,
          ...(updates.isKnownSuspicious && {
            ':suspicious': true,
            ':level': updates.suspicionLevel,
          }),
        },
      })
    );

    console.log(`Vehicle record updated: ${plateNumber}`);
  }
}
