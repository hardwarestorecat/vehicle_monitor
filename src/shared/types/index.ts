export interface ImageMetadata {
  cameraId: string;
  location: string;
  crossStreet: string;
  direction: string;
  timestamp: string;
  s3Key: string;
}

export interface PlateDetectionResult {
  plateNumber: string;
  plateState?: string;
  confidence: number;
  rawTextractData: any;
}

export interface IceLookupResult {
  found: boolean;
  status?: 'Confirmed ICE' | 'Highly suspected ICE';
  notes?: string;
  plateIssuer?: string;
  tags?: string[];
  matchedPlate?: string; // Which plate variation matched (for ambiguous character handling)
}

export interface VehicleAnalysis {
  // License plate data (extracted by Bedrock)
  plateNumber: string | null;
  plateState: string | null;
  plateConfidence: number;
  alternativePlates?: string[]; // Up to 3 alternative readings for ambiguous characters

  // Vehicle identification
  make: string; // e.g., "Chevrolet", "Ford", "Unknown"
  model: string; // e.g., "Tahoe", "F-150", "Unknown"
  year: string | null; // e.g., "2018-2022" or null
  color: string; // e.g., "black", "white", "silver"

  // Vehicle data
  vehicleType: string;
  tintLevel: 'none' | 'light' | 'moderate' | 'heavy';
  occupantCount: number;
  hasFaceMasks: boolean;
  hasTacticalGear: boolean;
  confidence: number;
  rawBedrockData: any;
}

export interface RiskAssessment {
  riskScore: number;
  breakdown: { [key: string]: number };
  action: 'auto_alert_main' | 'auto_alert_suspected' | 'alert_if_threshold' | 'no_alert';
  iceStatus?: 'Confirmed ICE' | 'Highly suspected ICE';
  reasoning: string;
}

export interface ProcessingResult {
  sightingId: string;
  plateNumber: string;
  plateState?: string;
  timestamp: string;
  imageMetadata: ImageMetadata;
  iceStatus?: 'Confirmed ICE' | 'Highly suspected ICE';
  vehicleAnalysis?: VehicleAnalysis;
  riskAssessment: RiskAssessment;
  alertSent: boolean;
  signalGroupType?: 'main' | 'suspected';
  destinationFolder: 'confirmed' | 'standard';
}

export interface ConfirmedSighting {
  plateNumber: string;
  timestamp: string;
  sightingId: string;
  plateState?: string;
  cameraId: string;
  location: string;
  crossStreet: string;
  direction: string;
  imageS3Key: string;

  // Vehicle identification
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: string | null;
  vehicleColor: string;
  vehicleType: string;

  iceStatus: 'Confirmed ICE' | 'Highly suspected ICE';
  textractConfidence: number;
  iceReason: 'known_database' | 'tactical_gear' | 'multiple_conditions';
  alertSent: boolean;
  signalGroupType: 'main' | 'suspected';
  ttl: number;
}

export interface StandardSighting {
  plateNumber: string;
  timestamp: string;
  sightingId: string;
  plateState?: string;
  cameraId: string;
  location: string;
  crossStreet: string;
  direction: string;
  imageS3Key: string;

  // Vehicle identification
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: string | null;
  vehicleColor: string;
  vehicleType: string;

  tintLevel: string;
  occupantCount: number;
  hasFaceMasks: boolean;
  hasTacticalGear: boolean;
  riskScore: number;
  alertSent: boolean;
  rawTextractData: any;
  rawBedrockData: any;
  ttl: number;
}

export interface Vehicle {
  plateNumber: string;
  platePrefix: string;
  state?: string;

  // Vehicle identification (most recent sighting)
  lastKnownMake?: string;
  lastKnownModel?: string;
  lastKnownColor?: string;
  lastKnownYear?: string;

  isKnownSuspicious: boolean;
  suspicionLevel: number;
  notes?: string;
  firstSeen: string;
  lastSeen: string;
  totalSightings: number;
}

export interface AlertMessage {
  plateNumber: string;
  plateState?: string;
  location: string;
  crossStreet: string;
  direction: string;
  timestamp: string;
  riskScore: number;
  iceStatus?: string;
  reasoning: string;
  imageS3Key: string;
  groupType: 'main' | 'suspected';
}
