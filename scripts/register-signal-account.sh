#!/bin/bash
set -e

echo "========================================="
echo "Signal Account Registration Helper"
echo "========================================="
echo ""
echo "This script helps you register your Signal account with signal-cli"
echo "on the Lambda EFS filesystem."
echo ""

# Configuration
LAMBDA_FUNCTION_NAME="VehicleMonitoringAlertStack-SignalApiFunction"
REGION="us-east-2"
PHONE_NUMBER="+14192965521"

echo "Phone Number: ${PHONE_NUMBER}"
echo "Lambda Function: ${LAMBDA_FUNCTION_NAME}"
echo ""

# Step 1: Register (generates captcha)
echo "Step 1: Registering with Signal..."
echo "This will generate a captcha that you need to solve."
echo ""

read -p "Press Enter to continue..."

aws lambda invoke \
  --function-name ${LAMBDA_FUNCTION_NAME} \
  --region ${REGION} \
  --payload '{"action": "register"}' \
  /tmp/signal-register-response.json

cat /tmp/signal-register-response.json
echo ""
echo ""

# Step 2: Get captcha
echo "Step 2: Solve the captcha"
echo ""
echo "1. Open: https://signalcaptchas.org/registration/generate.html"
echo "2. Complete the captcha"
echo "3. Copy the captcha token (signalcaptcha://...)"
echo ""

read -p "Enter the captcha token: " CAPTCHA_TOKEN
echo ""

# Step 3: Register with captcha
echo "Step 3: Completing registration with captcha..."
aws lambda invoke \
  --function-name ${LAMBDA_FUNCTION_NAME} \
  --region ${REGION} \
  --payload "{\"action\": \"register\", \"captcha\": \"${CAPTCHA_TOKEN}\"}" \
  /tmp/signal-register-captcha-response.json

cat /tmp/signal-register-captcha-response.json
echo ""
echo ""

# Step 4: Verify with code
echo "Step 4: Verification"
echo "Check your phone for a verification code from Signal."
echo ""

read -p "Enter the verification code: " VERIFICATION_CODE
echo ""

echo "Verifying account..."
aws lambda invoke \
  --function-name ${LAMBDA_FUNCTION_NAME} \
  --region ${REGION} \
  --payload "{\"action\": \"verify\", \"code\": \"${VERIFICATION_CODE}\"}" \
  /tmp/signal-verify-response.json

cat /tmp/signal-verify-response.json
echo ""
echo ""

# Step 5: Join group
echo "Step 5: Joining Signal group..."
echo ""
read -p "Press Enter to join the group..."

aws lambda invoke \
  --function-name ${LAMBDA_FUNCTION_NAME} \
  --region ${REGION} \
  --payload '{"action": "joinGroup"}' \
  /tmp/signal-join-response.json

cat /tmp/signal-join-response.json
echo ""
echo ""

echo "✅ Registration complete!"
echo ""
echo "Test sending a message with:"
echo "  aws lambda invoke --function-name ${LAMBDA_FUNCTION_NAME} --region ${REGION} \\"
echo "    --payload '{\"action\":\"test\"}' /tmp/signal-test.json"
