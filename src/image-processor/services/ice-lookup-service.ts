import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { IceLookupResult } from '../../shared/types';

interface IcePlateEntry {
  plateNumber: string;
  status: 'Confirmed ICE' | 'Highly suspected ICE';
  plateIssuer?: string;
  tags?: string[];
  notes?: string;
}

interface IcePlatesDatabase {
  lastUpdated: string;
  totalPlates: number;
  confirmed: number;
  suspected: number;
  plates: { [plateNumber: string]: IcePlateEntry };
}

export class IceLookupService {
  private s3Client: S3Client;
  private icePlatesMap: Map<string, IcePlateEntry> | null = null;
  private lastLoaded: Date | null = null;
  private bucketName: string;
  private configKey: string;

  constructor(bucketName: string, configKey: string) {
    this.s3Client = new S3Client({});
    this.bucketName = bucketName;
    this.configKey = configKey;
  }

  /**
   * Load ICE plates database from S3 (called on Lambda cold start)
   */
  async loadIcePlatesDatabase(): Promise<void> {
    console.log('Loading ICE plates database from S3...');
    const startTime = Date.now();

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: this.configKey,
      });

      const response = await this.s3Client.send(command);
      const jsonString = await response.Body?.transformToString();

      if (!jsonString) {
        throw new Error('Empty response from S3');
      }

      const database: IcePlatesDatabase = JSON.parse(jsonString);

      // Convert to Map for O(1) lookups
      this.icePlatesMap = new Map();
      for (const [plateNumber, entry] of Object.entries(database.plates)) {
        this.icePlatesMap.set(plateNumber.toUpperCase(), entry);
      }

      this.lastLoaded = new Date();

      const loadTime = Date.now() - startTime;
      console.log(`ICE plates database loaded successfully in ${loadTime}ms`);
      console.log(`Total plates in memory: ${this.icePlatesMap.size}`);
      console.log(`Confirmed: ${database.confirmed}, Suspected: ${database.suspected}`);
      console.log(`Last updated: ${database.lastUpdated}`);
    } catch (error) {
      console.error('Error loading ICE plates database:', error);
      throw new Error('Failed to load ICE plates database from S3');
    }
  }

  /**
   * Lookup a license plate in the ICE database
   */
  async lookupPlate(plateNumber: string): Promise<IceLookupResult> {
    // Ensure database is loaded
    if (!this.icePlatesMap) {
      await this.loadIcePlatesDatabase();
    }

    const normalizedPlate = plateNumber.toUpperCase().trim();
    const entry = this.icePlatesMap!.get(normalizedPlate);

    if (!entry) {
      return {
        found: false,
      };
    }

    return {
      found: true,
      status: entry.status,
      plateIssuer: entry.plateIssuer,
      tags: entry.tags,
      notes: entry.notes,
    };
  }

  /**
   * Lookup multiple license plate variations (for ambiguous character handling)
   * Returns the first match found, or not found if none match
   */
  async lookupMultiplePlates(plateNumbers: string[]): Promise<IceLookupResult & { matchedPlate?: string }> {
    // Ensure database is loaded
    if (!this.icePlatesMap) {
      await this.loadIcePlatesDatabase();
    }

    // Try each plate variation in order
    for (const plateNumber of plateNumbers) {
      const normalizedPlate = plateNumber.toUpperCase().trim();
      const entry = this.icePlatesMap!.get(normalizedPlate);

      if (entry) {
        console.log(`ICE database match found: ${normalizedPlate} (from alternatives: ${plateNumbers.join(', ')})`);
        return {
          found: true,
          status: entry.status,
          plateIssuer: entry.plateIssuer,
          tags: entry.tags,
          notes: entry.notes,
          matchedPlate: normalizedPlate, // Which alternative matched
        };
      }
    }

    return {
      found: false,
    };
  }

  /**
   * Check if database is loaded
   */
  isLoaded(): boolean {
    return this.icePlatesMap !== null;
  }

  /**
   * Get database stats
   */
  getStats(): { totalPlates: number; lastLoaded: Date | null } {
    return {
      totalPlates: this.icePlatesMap?.size || 0,
      lastLoaded: this.lastLoaded,
    };
  }
}
