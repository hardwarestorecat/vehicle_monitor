#!/bin/bash
set -e

# Configuration
AWS_REGION="us-east-2"
AWS_ACCOUNT="770171147232"
ECR_REPO_NAME="vehicle-monitoring-stream-processor"
ECR_URI="${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}"

echo "========================================="
echo "Building Stream Processor Docker Image"
echo "========================================="
echo ""
echo "ECR Repository: ${ECR_URI}"
echo "Region: ${AWS_REGION}"
echo ""

# Check if Docker is available
if command -v docker &> /dev/null; then
    echo "Docker found locally - building and pushing..."
    echo ""

    # Login to ECR
    echo "Logging in to ECR..."
    aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_URI}

    # Build the image
    echo ""
    echo "Building Docker image..."
    cd src/stream-processor
    docker build -t ${ECR_REPO_NAME}:latest .

    # Tag the image
    echo ""
    echo "Tagging image..."
    docker tag ${ECR_REPO_NAME}:latest ${ECR_URI}:latest

    # Push to ECR
    echo ""
    echo "Pushing image to ECR..."
    docker push ${ECR_URI}:latest

    echo ""
    echo "✅ Image successfully pushed to ECR!"
    echo ""
    echo "Next steps:"
    echo "1. Update the ECS task definition to use the new image"
    echo "2. Set desiredCount to 1 to start the stream processor"

else
    echo "❌ Docker not found in this environment."
    echo ""
    echo "Please build and push the image manually:"
    echo ""
    echo "1. Login to ECR:"
    echo "   aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_URI}"
    echo ""
    echo "2. Build the image:"
    echo "   cd src/stream-processor"
    echo "   docker build -t ${ECR_REPO_NAME}:latest ."
    echo ""
    echo "3. Tag the image:"
    echo "   docker tag ${ECR_REPO_NAME}:latest ${ECR_URI}:latest"
    echo ""
    echo "4. Push to ECR:"
    echo "   docker push ${ECR_URI}:latest"
    echo ""
    exit 1
fi
