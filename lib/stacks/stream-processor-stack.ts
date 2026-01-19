import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import { APP_CONFIG } from '../config/constants';

interface StreamProcessorStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  bucket: s3.Bucket;
  cameraCredentialsSecret: secretsmanager.Secret;
}

export class StreamProcessorStack extends cdk.Stack {
  public readonly streamProcessorService: ecs.FargateService;

  constructor(scope: Construct, id: string, props: StreamProcessorStackProps) {
    super(scope, id, props);

    // ECR Repository for stream processor image
    const repository = new ecr.Repository(this, 'StreamProcessorRepo', {
      repositoryName: 'vehicle-monitoring-stream-processor',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      imageScanOnPush: true,
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'StreamProcessorCluster', {
      vpc: props.vpc,
      clusterName: 'vehicle-monitoring-stream-processor',
    });

    // Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'StreamProcessorTaskDef', {
      memoryLimitMiB: APP_CONFIG.ecs.streamProcessor.memoryMiB,
      cpu: APP_CONFIG.ecs.streamProcessor.cpu,
    });

    // Container Definition (placeholder - will be built and pushed later)
    const container = taskDefinition.addContainer('StreamProcessorContainer', {
      image: ecs.ContainerImage.fromRegistry('public.ecr.aws/docker/library/node:20-alpine'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'stream-processor',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        BUCKET_NAME: props.bucket.bucketName,
        S3_PREFIX: APP_CONFIG.s3Prefixes.incoming,
      },
      secrets: {
        CAMERA_CREDENTIALS: ecs.Secret.fromSecretsManager(props.cameraCredentialsSecret),
      },
      command: ['sh', '-c', 'echo "Stream processor placeholder - build Docker image first" && sleep 3600'],
    });

    // Grant S3 permissions
    props.bucket.grantWrite(taskDefinition.taskRole);

    // Grant Secrets Manager permissions
    props.cameraCredentialsSecret.grantRead(taskDefinition.taskRole);

    // Fargate Service (will deploy when cameras arrive)
    this.streamProcessorService = new ecs.FargateService(this, 'StreamProcessorService', {
      cluster,
      taskDefinition,
      desiredCount: 0, // Start with 0 until cameras are ready
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE_SPOT',
          weight: 1,
        },
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'StreamProcessorRepoUri', {
      value: repository.repositoryUri,
      description: 'ECR repository URI for stream processor',
      exportName: 'VehicleMonitoringStreamProcessorRepoUri',
    });

    new cdk.CfnOutput(this, 'StreamProcessorServiceName', {
      value: this.streamProcessorService.serviceName,
      description: 'ECS service name for stream processor',
      exportName: 'VehicleMonitoringStreamProcessorService',
    });
  }
}
