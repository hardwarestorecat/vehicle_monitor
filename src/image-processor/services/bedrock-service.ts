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
    "confidence": <0-100, your confidence in the plate reading>,
    "alternatives": ["<alternative reading 1>", "<alternative reading 2>"]
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

CRITICAL - AMBIGUOUS CHARACTERS:
Some characters look similar and can be confused. When ANY character is unclear or could be read multiple ways, provide up to 2 alternative readings in the "alternatives" array:
- S vs 5 (SXH646 vs 5XH646)
- O vs 0 (O12ABC vs 012ABC)
- I vs 1 (I23XYZ vs 123XYZ)
- B vs 8 (B7A123 vs 87A123)
- Z vs 2 (Z9X456 vs 29X456)
- G vs 6 (G8H123 vs 68H123)
- Q vs 0 (Q5T789 vs 05T789)

Example: If you see what could be "SXH646" or "5XH646", provide:
- plateNumber: "5XH646" (your best guess)
- alternatives: ["SXH646"]

Example: If you see what could be "O12ABC", "012ABC", or "Q12ABC", provide:
- plateNumber: "O12ABC" (your best guess)
- alternatives: ["012ABC", "Q12ABC"]

If all characters are CLEARLY readable with no ambiguity, set alternatives to an empty array []

IMPORTANT VEHICLE ANALYSIS:
- Be very careful with tactical gear detection - only mark true if you see actual tactical vests, body armor, helmets, or military-style equipment
- Face masks include medical masks, gators, balaclavas, or any face coverings
- Count ALL visible occupants, even if partially visible
- For window tint: none (clear glass), light (slightly tinted), moderate (difficult to see inside), heavy (nearly impossible to see inside)

Respond ONLY with valid JSON, no other text.`;

      // Call Bedrock (using cross-region inference profile for Haiku 4.5)
      const modelId = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
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
      const alternatives = licensePlate.alternatives || [];

      // Extract vehicle info
      const vehicle = analysis.vehicle || {};

      console.log('Bedrock extraction results:');
      console.log(`  License Plate: ${plateNumber || 'NOT DETECTED'} (${plateState || 'unknown state'}) - Confidence: ${plateConfidence}%`);
      if (alternatives.length > 0) {
        console.log(`  Alternatives: ${alternatives.join(', ')}`);
      }
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
        alternativePlates: alternatives.map((alt: string) => alt.toUpperCase().replace(/[^A-Z0-9]/g, '')),

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
