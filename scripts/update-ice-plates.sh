#!/bin/bash
set -e

# Script to update ICE plates database
# Usage: ./scripts/update-ice-plates.sh [path-to-csv]

echo "================================================"
echo "ICE Plates Database Update Script"
echo "================================================"
echo ""

# Check if CSV file path is provided, otherwise use default
CSV_FILE="${1:-Plates-All Plates.csv}"

if [ ! -f "$CSV_FILE" ]; then
    echo "❌ Error: CSV file not found: $CSV_FILE"
    echo ""
    echo "Usage: ./scripts/update-ice-plates.sh [path-to-csv]"
    echo "Example: ./scripts/update-ice-plates.sh ~/Downloads/Plates-All\ Plates.csv"
    exit 1
fi

echo "📄 Input CSV: $CSV_FILE"
echo ""

# If CSV is not in current directory, copy it
if [ "$CSV_FILE" != "Plates-All Plates.csv" ]; then
    echo "Copying CSV to project directory..."
    cp "$CSV_FILE" "Plates-All Plates.csv"
    echo "✓ CSV copied"
    echo ""
fi

# Convert CSV to JSON
echo "🔄 Converting CSV to JSON..."
npx ts-node scripts/convert-csv-to-json.ts
echo ""

# Upload to S3
echo "☁️  Uploading to S3..."
export AWS_PROFILE=hardwarestorecat
aws s3 cp ice-plates.json s3://vehicle-monitoring-captured-frames-770171147232/vehicle_monitoring/assets/ice-plates.json --region us-east-2

echo ""
echo "================================================"
echo "✅ ICE Plates Database Updated Successfully!"
echo "================================================"
echo ""
echo "The Lambda function will automatically load the"
echo "new database on its next cold start."
echo ""
echo "To force an immediate reload, you can:"
echo "1. Update the Lambda function (triggers cold start)"
echo "2. Or just wait for the next natural cold start"
echo ""
