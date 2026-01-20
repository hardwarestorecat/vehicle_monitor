export const APP_CONFIG = {
  // AWS Configuration
  account: '770171147232',
  region: 'us-east-2',

  // Home State (for out-of-state detection)
  homeState: 'MN',
  adjacentStates: ['WI', 'IA', 'SD', 'ND'],

  // S3 Configuration
  bucketName: 'vehicle-monitoring',
  s3Prefixes: {
    incoming: 'vehicle_monitoring/captured/incoming/',
    confirmed: 'vehicle_monitoring/captured/confirmed/',
    standard: 'vehicle_monitoring/captured/standard/',
    assets: 'vehicle_monitoring/assets/',
    // Keep old prefixes for lifecycle rules (gradual migration)
    oldIncoming: 'incoming/',
    oldConfirmed: 'confirmed/',
    oldStandard: 'standard/',
  },

  // ICE Database
  icePlatesConfigKey: 'vehicle_monitoring/assets/ice-plates.json',

  // Timezone (for date-based folder organization)
  timezone: 'America/Chicago',

  // DynamoDB Tables
  tables: {
    confirmedSightings: 'confirmed_sightings',
    sightings: 'sightings',
    vehicles: 'vehicles',
  },

  // TTL Configuration (in days)
  ttl: {
    confirmedSightings: 180, // 6 months for confirmed ICE
    sightings: 90,           // 3 months for standard sightings
  },

  // Secrets Manager
  secrets: {
    cameraCredentials: 'vehicle-monitoring/camera-credentials',
    signalCredentials: 'vehicle-monitoring/signal-credentials',
  },

  // Lambda Configuration
  lambda: {
    timeout: 60,              // seconds
    memorySize: 1024,         // MB
    reservedConcurrency: 10,  // Prevent runaway costs
  },

  // ECS Configuration
  ecs: {
    streamProcessor: {
      cpu: 512,
      memoryMiB: 1024,
      desiredCount: 2,  // One task per camera
    },
    signalApi: {
      cpu: 256,
      memoryMiB: 512,
      desiredCount: 1,
    },
  },

  // Cost Control
  dailyCostAlertThreshold: 10, // USD

  // S3 Lifecycle
  lifecycle: {
    confirmedGlacierDays: 7,
    confirmedDeleteDays: 180,
    standardGlacierDays: 7,
    standardDeleteDays: 30,
    incomingDeleteDays: 1,
  },
};

export const ICE_STATUS = {
  CONFIRMED: 'Confirmed ICE',
  HIGHLY_SUSPECTED: 'Highly suspected ICE',
} as const;

export const ALERT_GROUP_TYPE = {
  MAIN: 'main',
  SUSPECTED: 'suspected',
} as const;
