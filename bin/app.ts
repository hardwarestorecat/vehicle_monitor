#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/stacks/network-stack';
import { StorageStack } from '../lib/stacks/storage-stack';
import { ImageProcessorStack } from '../lib/stacks/image-processor-stack';
import { AlertStack } from '../lib/stacks/alert-stack';
import { StreamProcessorStack } from '../lib/stacks/stream-processor-stack';
import { MonitoringStack } from '../lib/stacks/monitoring-stack';
import { APP_CONFIG } from '../lib/config/constants';

const app = new cdk.App();

const env = {
  account: APP_CONFIG.account,
  region: APP_CONFIG.region,
};

// Phase 1: Foundation Infrastructure
const networkStack = new NetworkStack(app, 'VehicleMonitoringNetworkStack', {
  env,
  description: 'Network infrastructure for Vehicle Monitoring System',
});

const storageStack = new StorageStack(app, 'VehicleMonitoringStorageStack', {
  env,
  description: 'Storage layer (S3, DynamoDB, EFS) for Vehicle Monitoring System',
  vpc: networkStack.vpc,
  efsSecurityGroup: networkStack.efsSecurityGroup,
});

storageStack.addDependency(networkStack);

// Phase 2: Image Processing (Priority)
const imageProcessorStack = new ImageProcessorStack(app, 'VehicleMonitoringImageProcessorStack', {
  env,
  description: 'Image processing Lambda with Textract and Bedrock',
  vpc: networkStack.vpc,
  bucket: storageStack.bucket,
  confirmedSightingsTable: storageStack.confirmedSightingsTable,
  sightingsTable: storageStack.sightingsTable,
  vehiclesTable: storageStack.vehiclesTable,
  cameraCredentialsSecret: storageStack.cameraCredentialsSecret,
});

imageProcessorStack.addDependency(networkStack);
imageProcessorStack.addDependency(storageStack);

// Phase 3: Signal Integration
const alertStack = new AlertStack(app, 'VehicleMonitoringAlertStack', {
  env,
  description: 'Signal API service for sending alerts',
  vpc: networkStack.vpc,
  fileSystem: storageStack.fileSystem,
  signalCredentialsSecret: storageStack.signalCredentialsSecret,
});

alertStack.addDependency(networkStack);
alertStack.addDependency(storageStack);

// Phase 4: Stream Capture (deploy when cameras arrive)
// const streamProcessorStack = new StreamProcessorStack(app, 'VehicleMonitoringStreamProcessorStack', {
//   env,
//   description: 'ECS tasks for RTSP stream capture and motion detection',
//   vpc: networkStack.vpc,
//   bucket: storageStack.bucket,
//   cameraCredentialsSecret: storageStack.cameraCredentialsSecret,
// });
//
// streamProcessorStack.addDependency(networkStack);
// streamProcessorStack.addDependency(storageStack);

// Phase 5: Monitoring
const monitoringStack = new MonitoringStack(app, 'VehicleMonitoringMonitoringStack', {
  env,
  description: 'CloudWatch dashboards and alarms',
  imageProcessorFunction: imageProcessorStack.imageProcessorFunction,
  bucket: storageStack.bucket,
  confirmedSightingsTable: storageStack.confirmedSightingsTable,
  sightingsTable: storageStack.sightingsTable,
});

monitoringStack.addDependency(imageProcessorStack);
monitoringStack.addDependency(storageStack);

app.synth();
