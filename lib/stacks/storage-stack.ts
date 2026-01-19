import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { APP_CONFIG } from '../config/constants';

interface StorageStackProps extends cdk.StackProps {
  vpc?: ec2.Vpc;
  efsSecurityGroup?: ec2.SecurityGroup;
}

export class StorageStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly confirmedSightingsTable: dynamodb.Table;
  public readonly sightingsTable: dynamodb.Table;
  public readonly vehiclesTable: dynamodb.Table;
  public readonly fileSystem: efs.FileSystem;
  public readonly cameraCredentialsSecret: secretsmanager.Secret;
  public readonly signalCredentialsSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props?: StorageStackProps) {
    super(scope, id, props);

    // S3 Bucket for captured frames
    this.bucket = new s3.Bucket(this, 'CapturedFramesBucket', {
      bucketName: `${APP_CONFIG.bucketName}-${APP_CONFIG.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'DeleteIncomingAfter1Day',
          prefix: APP_CONFIG.s3Prefixes.incoming,
          expiration: cdk.Duration.days(APP_CONFIG.lifecycle.incomingDeleteDays),
        },
        {
          id: 'ConfirmedGlacierTransition',
          prefix: APP_CONFIG.s3Prefixes.confirmed,
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(APP_CONFIG.lifecycle.confirmedGlacierDays),
            },
          ],
          expiration: cdk.Duration.days(APP_CONFIG.lifecycle.confirmedDeleteDays),
        },
        {
          id: 'StandardGlacierTransition',
          prefix: APP_CONFIG.s3Prefixes.standard,
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(APP_CONFIG.lifecycle.standardGlacierDays),
            },
          ],
          expiration: cdk.Duration.days(APP_CONFIG.lifecycle.standardDeleteDays),
        },
      ],
      eventBridgeEnabled: true, // For S3 event notifications
    });

    // DynamoDB Table: confirmed_sightings (High Priority - Confirmed/Suspected ICE)
    this.confirmedSightingsTable = new dynamodb.Table(this, 'ConfirmedSightingsTable', {
      tableName: APP_CONFIG.tables.confirmedSightings,
      partitionKey: {
        name: 'plateNumber',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // GSI1: cameraId-timestamp-index (all confirmed sightings from a camera)
    this.confirmedSightingsTable.addGlobalSecondaryIndex({
      indexName: 'cameraId-timestamp-index',
      partitionKey: {
        name: 'cameraId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2: iceStatus-timestamp-index (query by Confirmed vs Highly suspected)
    this.confirmedSightingsTable.addGlobalSecondaryIndex({
      indexName: 'iceStatus-timestamp-index',
      partitionKey: {
        name: 'iceStatus',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // DynamoDB Table: sightings (Standard detections with full analysis)
    this.sightingsTable = new dynamodb.Table(this, 'SightingsTable', {
      tableName: APP_CONFIG.tables.sightings,
      partitionKey: {
        name: 'plateNumber',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // GSI1: cameraId-timestamp-index (all sightings from a camera)
    this.sightingsTable.addGlobalSecondaryIndex({
      indexName: 'cameraId-timestamp-index',
      partitionKey: {
        name: 'cameraId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2: timestamp-index (recent sightings across all cameras)
    this.sightingsTable.addGlobalSecondaryIndex({
      indexName: 'timestamp-index',
      partitionKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // DynamoDB Table: vehicles (Known plates database)
    this.vehiclesTable = new dynamodb.Table(this, 'VehiclesTable', {
      tableName: APP_CONFIG.tables.vehicles,
      partitionKey: {
        name: 'plateNumber',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // GSI1: state-index (query by state)
    this.vehiclesTable.addGlobalSecondaryIndex({
      indexName: 'state-index',
      partitionKey: {
        name: 'state',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2: platePrefix-index (partial plate search)
    this.vehiclesTable.addGlobalSecondaryIndex({
      indexName: 'platePrefix-index',
      partitionKey: {
        name: 'platePrefix',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'plateNumber',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // EFS for Signal state (only create if VPC provided)
    if (props?.vpc && props?.efsSecurityGroup) {
      this.fileSystem = new efs.FileSystem(this, 'SignalStateFileSystem', {
        vpc: props.vpc,
        encrypted: true,
        lifecyclePolicy: efs.LifecyclePolicy.AFTER_7_DAYS,
        performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
        throughputMode: efs.ThroughputMode.BURSTING,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        securityGroup: props.efsSecurityGroup,
      });
    }

    // Secrets Manager: Camera Credentials
    this.cameraCredentialsSecret = new secretsmanager.Secret(this, 'CameraCredentialsSecret', {
      secretName: APP_CONFIG.secrets.cameraCredentials,
      description: 'RTSP URLs and metadata for security cameras',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          camera1: {
            rtspUrl: 'rtsp://user:pass@ip:port/stream',
            location: 'Front Gate',
            crossStreet: 'Main St & 1st Ave',
            direction: 'Northbound',
          },
          camera2: {
            rtspUrl: 'rtsp://user:pass@ip:port/stream',
            location: 'Back Exit',
            crossStreet: 'Oak St & 3rd Ave',
            direction: 'Southbound',
          },
        }),
        generateStringKey: 'placeholder',
      },
    });

    // Secrets Manager: Signal Credentials
    this.signalCredentialsSecret = new secretsmanager.Secret(this, 'SignalCredentialsSecret', {
      secretName: APP_CONFIG.secrets.signalCredentials,
      description: 'Signal bot phone number and group IDs',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          phoneNumber: '+1234567890',
          mainGroupId: 'group-id-for-main-alerts',
          suspectedGroupId: 'group-id-for-suspected-alerts',
        }),
        generateStringKey: 'placeholder',
      },
    });

    // Outputs
    new cdk.CfnOutput(this, 'BucketName', {
      value: this.bucket.bucketName,
      description: 'S3 bucket for captured frames',
      exportName: 'VehicleMonitoringBucketName',
    });

    new cdk.CfnOutput(this, 'ConfirmedSightingsTableName', {
      value: this.confirmedSightingsTable.tableName,
      description: 'DynamoDB table for confirmed ICE sightings',
      exportName: 'VehicleMonitoringConfirmedSightingsTable',
    });

    new cdk.CfnOutput(this, 'SightingsTableName', {
      value: this.sightingsTable.tableName,
      description: 'DynamoDB table for standard sightings',
      exportName: 'VehicleMonitoringSightingsTable',
    });

    new cdk.CfnOutput(this, 'VehiclesTableName', {
      value: this.vehiclesTable.tableName,
      description: 'DynamoDB table for known vehicles',
      exportName: 'VehicleMonitoringVehiclesTable',
    });

    if (this.fileSystem) {
      new cdk.CfnOutput(this, 'FileSystemId', {
        value: this.fileSystem.fileSystemId,
        description: 'EFS file system for Signal state',
        exportName: 'VehicleMonitoringFileSystemId',
      });
    }
  }
}
