#!/bin/bash
set -e

export AWS_PROFILE=hardwarestorecat
BUCKET="vehicle-monitoring-770171147232"
REGION="us-east-2"
FUNCTION="VehicleMonitoringImagePro-ImageProcessorFunction11-6fGYR0wfk8ow"
SAMPLE_DIR="bin/sample_photos"

echo "========================================================================"
echo "  Vehicle License Plate Monitoring - Sample Photos Test"
echo "========================================================================"
echo ""
echo "Testing all sample photos to verify:"
echo "  ✓ License plate detection (Claude via Bedrock)"
echo "  ✓ ICE database lookup"
echo "  ✓ Vehicle classification (Bedrock)"
echo "  ✓ Risk scoring"
echo "  ✓ DynamoDB storage"
echo ""
echo "========================================================================"
echo ""

# Get list of sample photos
PHOTOS=$(ls -1 "$SAMPLE_DIR"/*.jpeg 2>/dev/null || true)

if [ -z "$PHOTOS" ]; then
    echo "❌ No sample photos found in $SAMPLE_DIR"
    exit 1
fi

TOTAL_PHOTOS=$(echo "$PHOTOS" | wc -l)
CURRENT=0

for PHOTO in $PHOTOS; do
    CURRENT=$((CURRENT + 1))
    FILENAME=$(basename "$PHOTO")

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📸 Test $CURRENT/$TOTAL_PHOTOS: $FILENAME"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # Upload to S3
    S3_KEY="vehicle_monitoring/captured/incoming/test-$FILENAME"
    echo "⬆️  Uploading to S3..."
    aws s3 cp "$PHOTO" "s3://$BUCKET/$S3_KEY" --region "$REGION" --quiet

    # Get file size
    FILE_SIZE=$(stat -f%z "$PHOTO" 2>/dev/null || stat -c%s "$PHOTO" 2>/dev/null)

    # Invoke Lambda
    echo "⚙️  Processing with Lambda..."
    PAYLOAD=$(cat <<EOF
{
  "Records": [{
    "eventVersion": "2.1",
    "eventSource": "aws:s3",
    "awsRegion": "$REGION",
    "eventTime": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
    "eventName": "ObjectCreated:Put",
    "s3": {
      "s3SchemaVersion": "1.0",
      "configurationId": "TestInvoke",
      "bucket": {
        "name": "$BUCKET",
        "arn": "arn:aws:s3:::$BUCKET"
      },
      "object": {
        "key": "$S3_KEY",
        "size": $FILE_SIZE
      }
    }
  }]
}
EOF
)

    aws lambda invoke \
        --function-name "$FUNCTION" \
        --region "$REGION" \
        --payload "$PAYLOAD" \
        --cli-binary-format raw-in-base64-out \
        /tmp/response-$CURRENT.json > /dev/null 2>&1

    # Wait for processing to complete
    sleep 3

    # Get logs
    echo "📋 Processing Results:"
    echo ""
    LOGS=$(aws logs tail "/aws/lambda/$FUNCTION" \
        --region "$REGION" \
        --since 30s \
        --format short 2>/dev/null | grep -E "(Detected plate|ALERT|ICE database|Risk assessment|Classifying vehicle|Vehicle analysis|Bedrock analysis|saved to|moved to)" | tail -20)

    # Parse key information
    PLATE=$(echo "$LOGS" | grep "Detected plate:" | tail -1 | sed 's/.*Detected plate: //' | sed 's/ (.*//')
    CONFIDENCE=$(echo "$LOGS" | grep "Detected plate:" | tail -1 | grep -oE '\([0-9]+\.[0-9]+%\)' | tr -d '()')
    STATE=$(echo "$LOGS" | grep "Detected plate:" | tail -1 | grep -oE '\([^)]*state\)' | tr -d '()')

    IN_DATABASE=$(echo "$LOGS" | grep -q "ALERT.*ICE database" && echo "YES" || echo "NO")
    ICE_STATUS=$(echo "$LOGS" | grep "ALERT.*Status:" | sed 's/.*Status: //' || echo "N/A")
    RISK_SCORE=$(echo "$LOGS" | grep "Risk assessment:" | sed 's/.*Risk assessment: //' || echo "N/A")
    BEDROCK_RAN=$(echo "$LOGS" | grep -q "Classifying vehicle" && echo "YES" || echo "NO")

    # Display results
    if [ -n "$PLATE" ]; then
        echo "  🔍 License Plate Detected: $PLATE"
        [ -n "$STATE" ] && echo "     State: $STATE" || echo "     State: Unknown"
        [ -n "$CONFIDENCE" ] && echo "     Confidence: $CONFIDENCE"
    else
        echo "  ❌ No license plate detected"
    fi
    echo ""

    if [ "$IN_DATABASE" = "YES" ]; then
        echo "  🚨 ICE DATABASE MATCH!"
        echo "     Status: $ICE_STATUS"
        echo "     Action: Immediate alert + confirmed_sightings table"
    else
        echo "  ✓ Not in ICE database"
        if [ "$BEDROCK_RAN" = "YES" ]; then
            echo "     Bedrock Analysis: Completed"

            # Extract vehicle details from logs
            VEHICLE_TYPE=$(echo "$LOGS" | grep "Vehicle analysis:" | grep -oE "type: [^,]+" | sed 's/type: //')
            OCCUPANTS=$(echo "$LOGS" | grep "Vehicle analysis:" | grep -oE "occupants: [^,]+" | sed 's/occupants: //')

            [ -n "$VEHICLE_TYPE" ] && echo "     Vehicle Type: $VEHICLE_TYPE"
            [ -n "$OCCUPANTS" ] && echo "     Occupants: $OCCUPANTS"
        fi
        echo "     Risk Assessment: $RISK_SCORE"
    fi
    echo ""
    echo "────────────────────────────────────────────────────────────────────"
    echo ""
done

echo ""
echo "========================================================================"
echo "  DynamoDB Records Summary"
echo "========================================================================"
echo ""

# Query DynamoDB tables
echo "📊 Confirmed Sightings Table:"
CONFIRMED_COUNT=$(aws dynamodb scan \
    --table-name confirmed_sightings \
    --region "$REGION" \
    --select COUNT \
    --no-cli-pager 2>/dev/null | grep -oE '"Count": [0-9]+' | grep -oE '[0-9]+' || echo "0")

if [ "$CONFIRMED_COUNT" -gt 0 ]; then
    echo "   Total records: $CONFIRMED_COUNT"
    echo ""
    aws dynamodb scan \
        --table-name confirmed_sightings \
        --region "$REGION" \
        --no-cli-pager 2>/dev/null | \
        jq -r '.Items[] | "   • Plate: \(.plateNumber.S) | Status: \(.iceStatus.S) | Time: \(.timestamp.S)"' 2>/dev/null || echo "   (Unable to parse records)"
else
    echo "   No records found"
fi

echo ""
echo "📊 Standard Sightings Table:"
SIGHTINGS_COUNT=$(aws dynamodb scan \
    --table-name sightings \
    --region "$REGION" \
    --select COUNT \
    --no-cli-pager 2>/dev/null | grep -oE '"Count": [0-9]+' | grep -oE '[0-9]+' || echo "0")

if [ "$SIGHTINGS_COUNT" -gt 0 ]; then
    echo "   Total records: $SIGHTINGS_COUNT"
    echo ""
    aws dynamodb scan \
        --table-name sightings \
        --region "$REGION" \
        --no-cli-pager 2>/dev/null | \
        jq -r '.Items[] | "   • Plate: \(.plateNumber.S) | Risk: \(.riskScore.N) | Time: \(.timestamp.S)"' 2>/dev/null || echo "   (Unable to parse records)"
else
    echo "   No records found"
fi

echo ""
echo "📊 Vehicles Table:"
VEHICLES_COUNT=$(aws dynamodb scan \
    --table-name vehicles \
    --region "$REGION" \
    --select COUNT \
    --no-cli-pager 2>/dev/null | grep -oE '"Count": [0-9]+' | grep -oE '[0-9]+' || echo "0")

if [ "$VEHICLES_COUNT" -gt 0 ]; then
    echo "   Total records: $VEHICLES_COUNT"
    echo ""
    aws dynamodb scan \
        --table-name vehicles \
        --region "$REGION" \
        --no-cli-pager 2>/dev/null | \
        jq -r '.Items[] | "   • Plate: \(.plateNumber.S) | Sightings: \(.totalSightings.N) | Suspicious: \(.isKnownSuspicious.BOOL // false)"' 2>/dev/null || echo "   (Unable to parse records)"
else
    echo "   No records found"
fi

echo ""
echo "========================================================================"
echo "✅ Testing complete!"
echo "========================================================================"
echo ""
