import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
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

    // Lambda function for Signal API
    this.signalApiFunction = new lambda.Function(this, 'SignalApiFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
import json
import os
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event, context):
    """
    Signal API Lambda function
    TODO: Implement actual Signal CLI integration
    For now, logs the alert message
    """
    logger.info("Signal API Lambda invoked")
    logger.info(f"Event: {json.dumps(event)}")

    try:
        # Parse request body
        body = json.loads(event.get('body', '{}'))

        # Log the alert (placeholder for actual Signal sending)
        logger.info(f"Would send Signal alert: {json.dumps(body, indent=2)}")

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json'
            },
            'body': json.dumps({
                'success': True,
                'message': 'Alert logged (Signal integration pending)',
                'data': body
            })
        }
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
`),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
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
