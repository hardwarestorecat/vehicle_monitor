import { S3Event, S3EventRecord } from 'aws-lambda';
import { S3Client, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { IceLookupService } from './services/ice-lookup-service';
import { TextractService } from './services/textract-service';
import { BedrockService } from './services/bedrock-service';
import { RiskScorer } from './services/risk-scorer';
import { DynamoDBService } from './services/dynamodb-service';
import { ProcessingResult, ImageMetadata } from '../shared/types';
import { APP_CONFIG } from '../../lib/config/constants';
import { buildDateBasedS3Key, extractFilename } from '../shared/utils/date-utils';

// Initialize services (reused across invocations)
const iceLookupService = new IceLookupService(
  process.env.BUCKET_NAME!,
  process.env.ICE_PLATES_CONFIG_KEY!
);
const textractService = new TextractService();
const bedrockService = new BedrockService();
const riskScorer = new RiskScorer(
  process.env.HOME_STATE!,
  (process.env.ADJACENT_STATES || '').split(',')
);
const dynamoDBService = new DynamoDBService(
  process.env.CONFIRMED_SIGHTINGS_TABLE!,
  process.env.SIGHTINGS_TABLE!,
  process.env.VEHICLES_TABLE!,
  APP_CONFIG.ttl.confirmedSightings,
  APP_CONFIG.ttl.sightings
);
const s3Client = new S3Client({});

// Load ICE database on cold start
let iceDatabaseLoaded = false;

export const handler = async (event: S3Event): Promise<void> => {
  console.log('Image processor Lambda triggered');
  console.log('Event:', JSON.stringify(event, null, 2));

  // Load ICE database if not already loaded
  if (!iceDatabaseLoaded) {
    await iceLookupService.loadIcePlatesDatabase();
    iceDatabaseLoaded = true;
  }

  // Process each S3 record
  for (const record of event.Records) {
    try {
      await processImage(record);
    } catch (error) {
      console.error('Error processing image:', error);
      // Continue processing other records
    }
  }
};

async function processImage(record: S3EventRecord): Promise<void> {
  const bucketName = record.s3.bucket.name;
  const s3Key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

  console.log(`Processing image: s3://${bucketName}/${s3Key}`);

  // Extract metadata from S3 key or object metadata
  const imageMetadata = await extractMetadata(bucketName, s3Key);

  // Step 1: Use Bedrock to extract license plate AND analyze vehicle (single call)
  // This replaces Textract - much more accurate and cheaper!
  const analysis = await bedrockService.classifyVehicle(bucketName, s3Key);

  // Check if license plate was detected
  if (!analysis.plateNumber) {
    console.log('No license plate detected by Bedrock - skipping image');
    // Delete from /incoming/ since we can't process it
    await deleteFromIncoming(bucketName, s3Key);
    return;
  }

  const plateNumber = analysis.plateNumber;
  const plateState = analysis.plateState || undefined;
  const confidence = analysis.plateConfidence;

  console.log(`Detected plate: ${plateNumber} (${plateState || 'unknown state'}) - Confidence: ${confidence}%`);

  // Step 2: Check ICE database (PRIORITY #1)
  const iceLookup = await iceLookupService.lookupPlate(plateNumber);

  if (iceLookup.found) {
    console.log(`ALERT: Plate found in ICE database - Status: ${iceLookup.status}`);

    // Process as confirmed/suspected ICE without Bedrock analysis
    const result: ProcessingResult = {
      sightingId: uuidv4(),
      plateNumber,
      plateState,
      timestamp: new Date().toISOString(),
      imageMetadata,
      iceStatus: iceLookup.status,
      riskAssessment: {
        riskScore: 100,
        breakdown: { [iceLookup.status!]: 100 },
        action:
          iceLookup.status === 'Confirmed ICE' ? 'auto_alert_main' : 'auto_alert_suspected',
        iceStatus: iceLookup.status,
        reasoning: `License plate found in ${iceLookup.status} database`,
      },
      alertSent: false, // Will be set to true when alert is sent
      signalGroupType:
        iceLookup.status === 'Confirmed ICE' ? 'main' : 'suspected',
      destinationFolder: 'confirmed',
    };

    // Save to confirmed_sightings table
    await dynamoDBService.saveConfirmedSighting(result);

    // Update vehicle record
    await dynamoDBService.updateVehicleAfterSighting(
      plateNumber,
      100,
      iceLookup.status
    );

    // Move image to /confirmed/ folder
    await moveToDestinationFolder(bucketName, s3Key, 'confirmed', plateNumber);

    // TODO: Send Signal alert (Phase 3)
    console.log(
      `TODO: Send alert to ${result.signalGroupType} group for ${plateNumber}`
    );

    console.log(`Confirmed ICE processing complete: ${plateNumber}`);
    return;
  }

  // Step 3: Not in ICE database - use vehicle analysis from Bedrock
  // (We already have it from the initial Bedrock call that extracted the plate)
  console.log('Plate not in ICE database - using vehicle analysis from Bedrock');

  const vehicleAnalysis = analysis;

  // Get vehicle record
  const vehicle = await dynamoDBService.getOrCreateVehicle(plateNumber, plateState);

  // Step 4: Calculate risk score
  const riskAssessment = riskScorer.calculateRisk(
    vehicleAnalysis,
    plateState,
    iceLookup,
    vehicle.isKnownSuspicious
  );

  console.log(`Risk assessment: ${riskAssessment.reasoning}`);

  // Determine if this should be saved and alerted
  const shouldSave =
    riskAssessment.action !== 'no_alert' || riskAssessment.riskScore >= 30;

  if (!shouldSave) {
    console.log('Low risk - not saving to database');
    await deleteFromIncoming(bucketName, s3Key);
    return;
  }

  // Create processing result
  const result: ProcessingResult = {
    sightingId: uuidv4(),
    plateNumber,
    plateState,
    timestamp: new Date().toISOString(),
    imageMetadata,
    iceStatus: riskAssessment.iceStatus,
    vehicleAnalysis,
    riskAssessment,
    alertSent: false,
    signalGroupType:
      riskAssessment.action === 'auto_alert_suspected' ? 'suspected' : 'main',
    destinationFolder: riskAssessment.iceStatus ? 'confirmed' : 'standard',
  };

  // Save to appropriate table
  if (riskAssessment.iceStatus) {
    await dynamoDBService.saveConfirmedSighting(result);
  } else {
    await dynamoDBService.saveStandardSighting(result);
  }

  // Update vehicle record
  await dynamoDBService.updateVehicleAfterSighting(
    plateNumber,
    riskAssessment.riskScore,
    riskAssessment.iceStatus
  );

  // Move image to destination folder
  await moveToDestinationFolder(
    bucketName,
    s3Key,
    result.destinationFolder,
    plateNumber
  );

  // TODO: Send alert if needed (Phase 3)
  if (riskAssessment.action !== 'no_alert') {
    console.log(
      `TODO: Send alert to ${result.signalGroupType} group for ${plateNumber}`
    );
  }

  console.log(`Processing complete: ${plateNumber}`);
}

async function extractMetadata(
  bucketName: string,
  s3Key: string
): Promise<ImageMetadata> {
  // For now, extract from S3 key pattern or use defaults
  // Format expected: incoming/cameraId/timestamp.jpg
  const parts = s3Key.split('/');

  return {
    cameraId: parts[1] || 'unknown',
    location: 'Unknown Location',
    crossStreet: 'Unknown Cross Street',
    direction: 'Unknown Direction',
    timestamp: new Date().toISOString(),
    s3Key,
  };
}

async function moveToDestinationFolder(
  bucketName: string,
  sourceKey: string,
  folder: 'confirmed' | 'standard',
  plateNumber: string
): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${plateNumber}_${timestamp}.jpg`;

  // Get the appropriate S3 prefix for the folder type
  const prefix = folder === 'confirmed'
    ? APP_CONFIG.s3Prefixes.confirmed
    : APP_CONFIG.s3Prefixes.standard;

  // Build destination key with date-based folder structure
  // Example: vehicle_monitoring/captured/confirmed/2026-01-19/ABC123_2026-01-19T12-00-00-000Z.jpg
  const destinationKey = buildDateBasedS3Key(prefix, filename);

  console.log(`Moving image from ${sourceKey} to ${destinationKey}`);

  // Copy to destination
  await s3Client.send(
    new CopyObjectCommand({
      Bucket: bucketName,
      CopySource: `${bucketName}/${sourceKey}`,
      Key: destinationKey,
    })
  );

  // Delete from incoming
  await deleteFromIncoming(bucketName, sourceKey);

  console.log(`Image moved successfully to ${destinationKey}`);
}

async function deleteFromIncoming(bucketName: string, s3Key: string): Promise<void> {
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
    })
  );

  console.log(`Deleted from incoming: ${s3Key}`);
}
