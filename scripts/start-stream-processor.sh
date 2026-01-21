#!/bin/bash
set -e

echo "========================================="
echo "Starting Stream Processor Service"
echo "========================================="
echo ""

SERVICE_NAME="VehicleMonitoringStreamProcessorStack-StreamProcessorService07643C3F-vWlw0DQfWLfk"
CLUSTER_NAME="vehicle-monitoring-stream-processor"
REGION="us-east-2"

echo "Starting ECS service..."
aws ecs update-service \
  --cluster ${CLUSTER_NAME} \
  --service ${SERVICE_NAME} \
  --desired-count 1 \
  --region ${REGION} \
  --query 'service.[serviceName,desiredCount,runningCount]' \
  --output table

echo ""
echo "✅ Stream processor starting..."
echo ""
echo "Monitor logs with:"
echo "  aws logs tail /aws/ecs/stream-processor --follow --region ${REGION}"
echo ""
echo "Check running tasks:"
echo "  aws ecs list-tasks --cluster ${CLUSTER_NAME} --region ${REGION}"
echo ""
echo "Cost: ~$2.70/month when running 24/7"
