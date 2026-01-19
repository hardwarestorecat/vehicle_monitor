#!/bin/bash
set -e

echo "Setting up AWS CLI profile: hardwarestorecat"
echo "=============================================="
echo ""

# Check if aws CLI is installed
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed"
    echo "Please install it first: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
    exit 1
fi

echo "Please provide AWS credentials for account: 770171147232 (hardwarestorecat@gmail.com)"
echo ""

# Prompt for credentials
read -p "AWS Access Key ID: " ACCESS_KEY
read -s -p "AWS Secret Access Key: " SECRET_KEY
echo ""

# Configure profile
aws configure set aws_access_key_id "$ACCESS_KEY" --profile hardwarestorecat
aws configure set aws_secret_access_key "$SECRET_KEY" --profile hardwarestorecat
aws configure set region us-east-1 --profile hardwarestorecat
aws configure set output json --profile hardwarestorecat

echo ""
echo "Testing AWS credentials..."
if aws sts get-caller-identity --profile hardwarestorecat > /dev/null 2>&1; then
    echo "✓ AWS profile 'hardwarestorecat' configured successfully!"
    echo ""
    aws sts get-caller-identity --profile hardwarestorecat
else
    echo "✗ Failed to verify AWS credentials. Please check your access key and secret key."
    exit 1
fi

# Export profile for current session
echo ""
echo "To use this profile in your current session, run:"
echo "export AWS_PROFILE=hardwarestorecat"
