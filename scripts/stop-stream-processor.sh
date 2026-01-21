#!/bin/bash
set -e

echo "========================================="
echo "Stopping Stream Processor Service"
echo "========================================="
echo ""

SERVICE_NAME="VehicleMonitoringStreamProcessorStack-StreamProcessorService07643C3F-vWlw0DQfWLfk"
CLUSTER_NAME="vehicle-monitoring-stream-processor"
REGION="us-east-2"

echo "Stopping ECS service..."
aws ecs update-service \
  --cluster ${CLUSTER_NAME} \
  --service ${SERVICE_NAME} \
  --desired-count 0 \
  --region ${REGION} \
  --query 'service.[serviceName,desiredCount,runningCount]' \
  --output table

echo ""
echo "✅ Stream processor stopped!"
echo ""
echo "Cost savings: ~$2.70/month saved while stopped"
echo "Storage costs continue: ~$0.50/month (ECR image)"
echo ""
echo "To start again, run: ./scripts/start-stream-processor.sh"
