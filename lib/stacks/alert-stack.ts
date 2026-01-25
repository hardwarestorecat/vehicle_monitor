import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { APP_CONFIG } from '../config/constants';

interface AlertStackProps extends cdk.StackProps {
  signalCredentialsSecret: secretsmanager.Secret;
  bucket: s3.IBucket;
  notificationEmail?: string;
}

export class AlertStack extends cdk.Stack {
  public readonly signalApiFunction: lambda.Function;
  public readonly functionUrl: lambda.FunctionUrl;
  public readonly sessionExpiryTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: AlertStackProps) {
    super(scope, id, props);

    // ECR Repository for Signal Lambda image (reference existing)
    const repository = ecr.Repository.fromRepositoryName(
      this,
      'SignalApiRepo',
      'vehicle-monitoring-signal-api'
    );

    // SNS Topic for Signal session expiry notifications
    this.sessionExpiryTopic = new sns.Topic(this, 'SignalSessionExpiryTopic', {
      displayName: 'Signal Session Expiry Alerts',
      topicName: 'vehicle-monitoring-signal-session-expiry',
    });

    // Subscribe email if provided
    if (props.notificationEmail) {
      this.sessionExpiryTopic.addSubscription(
        new subscriptions.EmailSubscription(props.notificationEmail)
      );
    }

    // Lambda function for Signal API (using container image, NO VPC)
    this.signalApiFunction = new lambda.DockerImageFunction(this, 'SignalApiFunction', {
      code: lambda.DockerImageCode.fromEcr(repository, {
        tagOrDigest: 'latest',
      }),
      memorySize: 1024, // 1GB for Java + signal-cli
      timeout: cdk.Duration.seconds(60), // Increased for signal-cli operations
      environment: {
        SIGNAL_CLI_CONFIG_DIR: '/tmp/signal-cli',
        SIGNAL_CREDENTIALS_SECRET: props.signalCredentialsSecret.secretName,
        SIGNAL_CREDENTIALS_S3_BUCKET: props.bucket.bucketName,
        SIGNAL_CREDENTIALS_S3_KEY: 'signal-cli/credentials.tar.gz',
        SESSION_EXPIRY_SNS_TOPIC: this.sessionExpiryTopic.topicArn,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant access to Signal credentials secret
    props.signalCredentialsSecret.grantRead(this.signalApiFunction);

    // Grant S3 access for credentials
    props.bucket.grantRead(this.signalApiFunction, 'signal-cli/*');

    // Grant SNS publish permissions
    this.sessionExpiryTopic.grantPublish(this.signalApiFunction);

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

    new cdk.CfnOutput(this, 'SessionExpiryTopicArn', {
      value: this.sessionExpiryTopic.topicArn,
      description: 'SNS topic for Signal session expiry notifications',
      exportName: 'VehicleMonitoringSignalSessionExpiryTopic',
    });
  }
}
