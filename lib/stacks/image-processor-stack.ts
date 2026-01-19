import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import { Construct } from 'constructs';
import { APP_CONFIG } from '../config/constants';
import * as path from 'path';

interface ImageProcessorStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  bucket: s3.Bucket;
  confirmedSightingsTable: dynamodb.Table;
  sightingsTable: dynamodb.Table;
  vehiclesTable: dynamodb.Table;
  cameraCredentialsSecret: secretsmanager.Secret;
}

export class ImageProcessorStack extends cdk.Stack {
  public readonly imageProcessorFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: ImageProcessorStackProps) {
    super(scope, id, props);

    // Lambda function for image processing
    this.imageProcessorFunction = new lambda.Function(this, 'ImageProcessorFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src/image-processor'), {
        bundling: {
          image: lambda.Runtime.NODEJS_20_X.bundlingImage,
          command: [
            'bash', '-c',
            'cp -r . /asset-output/'
          ],
        },
      }),
      timeout: cdk.Duration.seconds(APP_CONFIG.lambda.timeout),
      memorySize: APP_CONFIG.lambda.memorySize,
      reservedConcurrentExecutions: APP_CONFIG.lambda.reservedConcurrency,
      environment: {
        BUCKET_NAME: props.bucket.bucketName,
        CONFIRMED_SIGHTINGS_TABLE: props.confirmedSightingsTable.tableName,
        SIGHTINGS_TABLE: props.sightingsTable.tableName,
        VEHICLES_TABLE: props.vehiclesTable.tableName,
        ICE_PLATES_CONFIG_KEY: APP_CONFIG.icePlatesConfigKey,
        HOME_STATE: APP_CONFIG.homeState,
        ADJACENT_STATES: APP_CONFIG.adjacentStates.join(','),
        ENABLE_AI_ANALYSIS: 'true',
      },
    });

    // Grant permissions
    props.bucket.grantReadWrite(this.imageProcessorFunction);
    props.confirmedSightingsTable.grantReadWriteData(this.imageProcessorFunction);
    props.sightingsTable.grantReadWriteData(this.imageProcessorFunction);
    props.vehiclesTable.grantReadWriteData(this.imageProcessorFunction);

    // Grant Textract permissions
    this.imageProcessorFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'textract:DetectDocumentText',
        'textract:AnalyzeDocument',
      ],
      resources: ['*'],
    }));

    // Grant Bedrock permissions
    this.imageProcessorFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeModel',
      ],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`,
      ],
    }));

    // S3 Event Notification: Trigger Lambda on new images in /incoming/
    // Note: This will be configured after initial deployment to avoid circular dependency
    // props.bucket.addEventNotification(
    //   s3.EventType.OBJECT_CREATED,
    //   new s3n.LambdaDestination(this.imageProcessorFunction),
    //   {
    //     prefix: APP_CONFIG.s3Prefixes.incoming,
    //   }
    // );

    // Outputs
    new cdk.CfnOutput(this, 'ImageProcessorFunctionName', {
      value: this.imageProcessorFunction.functionName,
      description: 'Lambda function for image processing',
      exportName: 'VehicleMonitoringImageProcessorFunction',
    });
  }
}
