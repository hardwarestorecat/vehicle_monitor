import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import { APP_CONFIG } from '../config/constants';
import * as path from 'path';

interface AlertStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  fileSystem: efs.FileSystem;
  signalCredentialsSecret: secretsmanager.Secret;
  lambdaSecurityGroup: ec2.SecurityGroup;
}

export class AlertStack extends cdk.Stack {
  public readonly signalApiFunction: lambda.Function;
  public readonly functionUrl: lambda.FunctionUrl;

  constructor(scope: Construct, id: string, props: AlertStackProps) {
    super(scope, id, props);

    // ECR Repository for Signal Lambda image
    const repository = new ecr.Repository(this, 'SignalApiRepo', {
      repositoryName: 'vehicle-monitoring-signal-api',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      imageScanOnPush: true,
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

    // Lambda function for Signal API (using container image)
    this.signalApiFunction = new lambda.DockerImageFunction(this, 'SignalApiFunction', {
      code: lambda.DockerImageCode.fromEcr(repository, {
        tagOrDigest: 'latest',
      }),
      memorySize: 1024, // 1GB for Java + signal-cli
      timeout: cdk.Duration.seconds(60), // Increased for signal-cli operations
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      securityGroups: [props.lambdaSecurityGroup],
      allowPublicSubnet: true,
      filesystem: lambda.FileSystem.fromEfsAccessPoint(accessPoint, '/mnt/efs'),
      environment: {
        SIGNAL_CLI_CONFIG_DIR: '/mnt/efs/signal-cli',
        SIGNAL_CREDENTIALS_SECRET: props.signalCredentialsSecret.secretName,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant access to Signal credentials
    props.signalCredentialsSecret.grantRead(this.signalApiFunction);

    // Grant EFS permissions
    props.fileSystem.grant(
      this.signalApiFunction,
      'elasticfilesystem:ClientMount',
      'elasticfilesystem:ClientWrite'
    );

    // Create Function URL for HTTP access
    this.functionUrl = this.signalApiFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
      },
    });

    // Outputs
    new cdk.CfnOutput(this, 'SignalApiRepoUri', {
      value: repository.repositoryUri,
      description: 'ECR repository URI for Signal API Lambda',
      exportName: 'VehicleMonitoringSignalApiRepoUri',
    });

    new cdk.CfnOutput(this, 'SignalApiFunctionUrl', {
      value: this.functionUrl.url,
      description: 'Signal API Lambda Function URL',
      exportName: 'VehicleMonitoringSignalApiUrl',
    });

    new cdk.CfnOutput(this, 'SignalApiFunctionName', {
      value: this.signalApiFunction.functionName,
      description: 'Signal API Lambda function name',
      exportName: 'VehicleMonitoringSignalApiFunction',
    });
  }
}
