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
   * Classify vehicle using Bedrock (Claude Haiku)
   */
  async classifyVehicle(bucketName: string, s3Key: string): Promise<VehicleAnalysis> {
    console.log('Classifying vehicle with Bedrock...');
    const startTime = Date.now();

    try {
      // Get image from S3
      const imageBytes = await this.getImageFromS3(bucketName, s3Key);

      // Prepare prompt for Claude
      const prompt = `You are analyzing a vehicle image from a security camera for threat assessment.

Analyze this image and provide the following information in JSON format:

{
  "vehicleType": "sedan|suv|truck|van|crossover|motorcycle|other",
  "tintLevel": "none|light|moderate|heavy",
  "occupantCount": <number of visible occupants>,
  "hasFaceMasks": <true if any occupants wearing face masks/gators/balaclavas>,
  "hasTacticalGear": <true if tactical vests, body armor, helmets, or military-style equipment visible>,
  "confidence": <0-100, your confidence in this assessment>
}

IMPORTANT:
- Be very careful with tactical gear detection - only mark true if you see actual tactical vests, body armor, helmets, or military-style equipment
- Face masks include medical masks, gators, balaclavas, or any face coverings
- Count ALL visible occupants, even if partially visible
- For window tint: none (clear glass), light (slightly tinted), moderate (difficult to see inside), heavy (nearly impossible to see inside)

Respond ONLY with valid JSON, no other text.`;

      // Call Bedrock
      const modelId = 'anthropic.claude-3-haiku-20240307-v1:0';
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

      console.log('Vehicle analysis:', {
        type: analysis.vehicleType,
        tint: analysis.tintLevel,
        occupants: analysis.occupantCount,
        faceMasks: analysis.hasFaceMasks,
        tacticalGear: analysis.hasTacticalGear,
        confidence: analysis.confidence,
      });

      return {
        vehicleType: analysis.vehicleType || 'unknown',
        tintLevel: analysis.tintLevel || 'none',
        occupantCount: analysis.occupantCount || 0,
        hasFaceMasks: analysis.hasFaceMasks || false,
        hasTacticalGear: analysis.hasTacticalGear || false,
        confidence: analysis.confidence || 0,
        rawBedrockData: responseBody,
      };
    } catch (error) {
      console.error('Error classifying vehicle with Bedrock:', error);
      // Return default analysis on error (don't fail the entire pipeline)
      return {
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
