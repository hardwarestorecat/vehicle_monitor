import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { VehicleAnalysis } from '../../shared/types';

export class BedrockService {
  private bedrockClient: BedrockRuntimeClient;
  private s3Client: S3Client;

  constructor() {
    this.bedrockClient = new BedrockRuntimeClient({});
    this.s3Client = new S3Client({});
  }

  /**
   * Extract license plate AND classify vehicle using Bedrock (Claude Haiku)
   * This replaces both Textract and vehicle classification in a single call
   */
  async classifyVehicle(bucketName: string, s3Key: string): Promise<VehicleAnalysis> {
    console.log('Analyzing image with Bedrock (license plate + vehicle details)...');
    const startTime = Date.now();

    try {
      // Get image from S3
      const imageBytes = await this.getImageFromS3(bucketName, s3Key);

      // Prepare comprehensive prompt for Claude
      const prompt = `You are analyzing a vehicle image from a security camera. Extract the license plate AND analyze the vehicle.

Analyze this image and provide the following information in JSON format:

{
  "licensePlate": {
    "plateNumber": "<the license plate text, uppercase, no spaces or dashes>",
    "state": "<2-letter state code if visible, or null>",
    "confidence": <0-100, your confidence in the plate reading>
  },
  "vehicle": {
    "vehicleType": "sedan|suv|truck|van|crossover|motorcycle|other",
    "tintLevel": "none|light|moderate|heavy",
    "occupantCount": <number of visible occupants>,
    "hasFaceMasks": <true if any occupants wearing face masks/gators/balaclavas>,
    "hasTacticalGear": <true if tactical vests, body armor, helmets, or military-style equipment visible>,
    "confidence": <0-100, your confidence in this vehicle assessment>
  }
}

IMPORTANT LICENSE PLATE EXTRACTION:
- Look carefully for license plates on the front, rear, or side of the vehicle
- Extract the exact text/numbers from the plate
- Remove any spaces, dashes, or special characters (e.g., "ABC-123" becomes "ABC123")
- If you can see the state abbreviation or state name on the plate, include it
- If no license plate is visible, set plateNumber to null

IMPORTANT VEHICLE ANALYSIS:
- Be very careful with tactical gear detection - only mark true if you see actual tactical vests, body armor, helmets, or military-style equipment
- Face masks include medical masks, gators, balaclavas, or any face coverings
- Count ALL visible occupants, even if partially visible
- For window tint: none (clear glass), light (slightly tinted), moderate (difficult to see inside), heavy (nearly impossible to see inside)

Respond ONLY with valid JSON, no other text.`;

      // Call Bedrock (using cross-region inference profile)
      const modelId = 'us.anthropic.claude-3-haiku-20240307-v1:0';
      const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 500,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: imageBytes.toString('base64'),
                  },
                },
                {
                  type: 'text',
                  text: prompt,
                },
              ],
            },
          ],
        }),
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      const processingTime = Date.now() - startTime;
      console.log(`Bedrock analysis completed in ${processingTime}ms`);

      // Parse the response
      const analysisText = responseBody.content[0].text;
      const analysis = JSON.parse(analysisText);

      // Extract license plate info
      const licensePlate = analysis.licensePlate || {};
      const plateNumber = licensePlate.plateNumber;
      const plateState = licensePlate.state;
      const plateConfidence = licensePlate.confidence || 0;

      // Extract vehicle info
      const vehicle = analysis.vehicle || {};

      console.log('Bedrock extraction results:');
      console.log(`  License Plate: ${plateNumber || 'NOT DETECTED'} (${plateState || 'unknown state'}) - Confidence: ${plateConfidence}%`);
      console.log('  Vehicle analysis:', {
        type: vehicle.vehicleType,
        tint: vehicle.tintLevel,
        occupants: vehicle.occupantCount,
        faceMasks: vehicle.hasFaceMasks,
        tacticalGear: vehicle.hasTacticalGear,
        confidence: vehicle.confidence,
      });

      return {
        // License plate data
        plateNumber: plateNumber ? plateNumber.toUpperCase().replace(/[^A-Z0-9]/g, '') : null,
        plateState: plateState ? plateState.toUpperCase() : null,
        plateConfidence: plateConfidence,

        // Vehicle data
        vehicleType: vehicle.vehicleType || 'unknown',
        tintLevel: vehicle.tintLevel || 'none',
        occupantCount: vehicle.occupantCount || 0,
        hasFaceMasks: vehicle.hasFaceMasks || false,
        hasTacticalGear: vehicle.hasTacticalGear || false,
        confidence: vehicle.confidence || 0,
        rawBedrockData: responseBody,
      };
    } catch (error) {
      console.error('Error analyzing with Bedrock:', error);
      // Return default analysis with no plate detected (don't fail the entire pipeline)
      return {
        plateNumber: null,
        plateState: null,
        plateConfidence: 0,
        vehicleType: 'unknown',
        tintLevel: 'none',
        occupantCount: 0,
        hasFaceMasks: false,
        hasTacticalGear: false,
        confidence: 0,
        rawBedrockData: { error: String(error) },
      };
    }
  }

  /**
   * Get image bytes from S3
   */
  private async getImageFromS3(bucketName: string, s3Key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
    });

    const response = await this.s3Client.send(command);
    const bytes = await response.Body?.transformToByteArray();

    if (!bytes) {
      throw new Error('Failed to read image from S3');
    }

    return Buffer.from(bytes);
  }
}
