import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';
import { APP_CONFIG } from '../config/constants';

interface MonitoringStackProps extends cdk.StackProps {
  imageProcessorFunction: lambda.Function;
  bucket: s3.Bucket;
  confirmedSightingsTable: dynamodb.Table;
  sightingsTable: dynamodb.Table;
}

export class MonitoringStack extends cdk.Stack {
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    // SNS Topic for alarms
    const alarmTopic = new sns.Topic(this, 'MonitoringAlarmTopic', {
      topicName: 'vehicle-monitoring-alarms',
      displayName: 'Vehicle Monitoring System Alarms',
    });

    // CloudWatch Dashboard
    this.dashboard = new cloudwatch.Dashboard(this, 'VehicleMonitoringDashboard', {
      dashboardName: 'VehicleMonitoringSystem',
    });

    // Lambda Metrics
    const lambdaErrorRate = new cloudwatch.MathExpression({
      expression: '(errors / invocations) * 100',
      usingMetrics: {
        errors: props.imageProcessorFunction.metricErrors({
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
        }),
        invocations: props.imageProcessorFunction.metricInvocations({
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
        }),
      },
      label: 'Error Rate (%)',
    });

    // Lambda Error Alarm
    const lambdaErrorAlarm = new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      metric: lambdaErrorRate,
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'Image processor Lambda error rate > 5%',
      alarmName: 'vehicle-monitoring-lambda-errors',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    lambdaErrorAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));

    // Lambda Duration Alarm
    const lambdaDurationAlarm = new cloudwatch.Alarm(this, 'LambdaDurationAlarm', {
      metric: props.imageProcessorFunction.metricDuration({
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 50000, // 50 seconds (near timeout)
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'Image processor Lambda duration approaching timeout',
      alarmName: 'vehicle-monitoring-lambda-duration',
    });

    lambdaDurationAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));

    // Dashboard Widgets
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Invocations',
        left: [
          props.imageProcessorFunction.metricInvocations({
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        left: [
          props.imageProcessorFunction.metricErrors({
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
      })
    );

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Duration (ms)',
        left: [
          props.imageProcessorFunction.metricDuration({
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Error Rate (%)',
        left: [lambdaErrorRate],
        width: 12,
      })
    );

    // DynamoDB Metrics
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Confirmed Sightings - Write Capacity',
        left: [
          props.confirmedSightingsTable.metricConsumedWriteCapacityUnits({
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Sightings - Write Capacity',
        left: [
          props.sightingsTable.metricConsumedWriteCapacityUnits({
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
      })
    );

    // Outputs
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${this.dashboard.dashboardName}`,
      description: 'CloudWatch Dashboard URL',
      exportName: 'VehicleMonitoringDashboardUrl',
    });

    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: alarmTopic.topicArn,
      description: 'SNS topic for monitoring alarms',
      exportName: 'VehicleMonitoringAlarmTopicArn',
    });
  }
}
