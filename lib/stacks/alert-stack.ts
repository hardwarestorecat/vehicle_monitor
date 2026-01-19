import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { APP_CONFIG } from '../config/constants';

interface AlertStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  fileSystem: efs.FileSystem;
  signalCredentialsSecret: secretsmanager.Secret;
}

export class AlertStack extends cdk.Stack {
  public readonly signalApiService: ecs.FargateService;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: AlertStackProps) {
    super(scope, id, props);

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'SignalApiCluster', {
      vpc: props.vpc,
      clusterName: 'vehicle-monitoring-signal-api',
    });

    // Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'SignalApiTaskDef', {
      memoryLimitMiB: APP_CONFIG.ecs.signalApi.memoryMiB,
      cpu: APP_CONFIG.ecs.signalApi.cpu,
    });

    // EFS Access Point for Signal data
    const accessPoint = new efs.AccessPoint(this, 'SignalDataAccessPoint', {
      fileSystem: props.fileSystem,
      path: '/signal-data',
      posixUser: {
        uid: '1000',
        gid: '1000',
      },
      createAcl: {
        ownerUid: '1000',
        ownerGid: '1000',
        permissions: '755',
      },
    });

    // Add EFS volume to task definition
    taskDefinition.addVolume({
      name: 'signal-data',
      efsVolumeConfiguration: {
        fileSystemId: props.fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId,
        },
      },
    });

    // Container Definition (signal-cli-rest-api)
    const container = taskDefinition.addContainer('SignalApiContainer', {
      image: ecs.ContainerImage.fromRegistry('bbernhard/signal-cli-rest-api:latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'signal-api',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        MODE: 'native',
      },
      secrets: {
        SIGNAL_PHONE_NUMBER: ecs.Secret.fromSecretsManager(props.signalCredentialsSecret, 'phoneNumber'),
      },
    });

    // Mount EFS volume
    container.addMountPoints({
      containerPath: '/home/.local/share/signal-cli',
      sourceVolume: 'signal-data',
      readOnly: false,
    });

    // Port mapping
    container.addPortMappings({
      containerPort: 8080,
      protocol: ecs.Protocol.TCP,
    });

    // Internal Application Load Balancer
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'SignalApiALB', {
      vpc: props.vpc,
      internetFacing: false,
      loadBalancerName: 'signal-api-internal',
    });

    // Target Group
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'SignalApiTargetGroup', {
      vpc: props.vpc,
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/v1/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    // Listener
    this.loadBalancer.addListener('SignalApiListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [targetGroup],
    });

    // Fargate Service
    this.signalApiService = new ecs.FargateService(this, 'SignalApiService', {
      cluster,
      taskDefinition,
      desiredCount: APP_CONFIG.ecs.signalApi.desiredCount,
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE_SPOT',
          weight: 1,
        },
      ],
    });

    // Attach to target group
    this.signalApiService.attachToApplicationTargetGroup(targetGroup);

    // Grant EFS permissions
    props.fileSystem.grant(taskDefinition.taskRole, 'elasticfilesystem:ClientMount', 'elasticfilesystem:ClientWrite');

    // Outputs
    new cdk.CfnOutput(this, 'SignalApiUrl', {
      value: `http://${this.loadBalancer.loadBalancerDnsName}`,
      description: 'Internal URL for Signal API',
      exportName: 'VehicleMonitoringSignalApiUrl',
    });

    new cdk.CfnOutput(this, 'SignalApiServiceName', {
      value: this.signalApiService.serviceName,
      description: 'ECS service name for Signal API',
      exportName: 'VehicleMonitoringSignalApiService',
    });
  }
}
