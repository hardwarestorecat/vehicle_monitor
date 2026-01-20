import { TextractClient, DetectDocumentTextCommand } from '@aws-sdk/client-textract';
import { PlateDetectionResult } from '../../shared/types';

export class TextractService {
  private textractClient: TextractClient;

  constructor() {
    this.textractClient = new TextractClient({});
  }

  /**
   * Extract license plate text from image using Textract
   */
  async extractPlateFromImage(
    bucketName: string,
    s3Key: string
  ): Promise<PlateDetectionResult | null> {
    console.log('Extracting text from image using Textract...');
    const startTime = Date.now();

    try {
      const command = new DetectDocumentTextCommand({
        Document: {
          S3Object: {
            Bucket: bucketName,
            Name: s3Key,
          },
        },
      });

      const response = await this.textractClient.send(command);
      const processingTime = Date.now() - startTime;

      if (!response.Blocks || response.Blocks.length === 0) {
        console.log('No text detected in image');
        return null;
      }

      // Extract all text lines
      const textLines: Array<{ text: string; confidence: number }> = [];
      for (const block of response.Blocks) {
        if (block.BlockType === 'LINE' && block.Text && block.Confidence) {
          textLines.push({
            text: block.Text,
            confidence: block.Confidence,
          });
        }
      }

      console.log(`Textract found ${textLines.length} text lines in ${processingTime}ms`);

      // Find the most likely license plate
      const plateResult = this.findLicensePlate(textLines);

      if (!plateResult) {
        console.log('No license plate pattern detected');
        return null;
      }

      console.log(`Detected plate: ${plateResult.plateNumber} (confidence: ${plateResult.confidence.toFixed(2)}%)`);

      return {
        ...plateResult,
        rawTextractData: response.Blocks,
      };
    } catch (error) {
      console.error('Error extracting text with Textract:', error);
      throw new Error('Failed to extract plate with Textract');
    }
  }

  /**
   * Find license plate from detected text lines
   */
  private findLicensePlate(
    textLines: Array<{ text: string; confidence: number }>
  ): { plateNumber: string; plateState?: string; confidence: number } | null {
    // License plate patterns (prioritized)
    const patterns = [
      // Standard US plates (2-4 letters, 2-4 numbers, optional letters)
      /^([A-Z]{2,4})\s?[-]?\s?(\d{2,4})\s?([A-Z]{0,2})$/i,
      // Numbers first
      /^(\d{2,4})\s?[-]?\s?([A-Z]{2,4})\s?([A-Z]{0,2})$/i,
      // All letters/numbers mixed
      /^([A-Z0-9]{5,8})$/i,
    ];

    // State abbreviations (common patterns)
    const statePatterns = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|US|DP|GV)\b/i;

    let bestMatch: { plateNumber: string; plateState?: string; confidence: number } | null = null;

    for (const line of textLines) {
      const cleanText = line.text.replace(/[^A-Z0-9\s-]/gi, '').trim();

      // Try each pattern
      for (const pattern of patterns) {
        const match = cleanText.match(pattern);
        if (match) {
          const plateNumber = cleanText.replace(/\s|-/g, '').toUpperCase();

          // Skip if too short or too long
          if (plateNumber.length < 4 || plateNumber.length > 10) {
            continue;
          }

          // Check if this is better than current best
          if (!bestMatch || line.confidence > bestMatch.confidence) {
            bestMatch = {
              plateNumber,
              confidence: line.confidence,
            };
          }
        }
      }

      // Check for state abbreviation in the same or nearby lines
      const stateMatch = line.text.match(statePatterns);
      if (stateMatch && bestMatch) {
        bestMatch.plateState = stateMatch[1].toUpperCase();
      }
    }

    // Try to find state from other lines if not found yet
    if (bestMatch && !bestMatch.plateState) {
      for (const line of textLines) {
        const stateMatch = line.text.match(statePatterns);
        if (stateMatch) {
          bestMatch.plateState = stateMatch[1].toUpperCase();
          break;
        }
      }
    }

    return bestMatch;
  }
}
