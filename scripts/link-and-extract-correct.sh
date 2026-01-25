#!/bin/bash
set -e

SIGNAL_DIR="/root/.local/share/signal-cli-working"
rm -rf "$SIGNAL_DIR"
mkdir -p "$SIGNAL_DIR"

echo "=== Step 1: Start container ==="
docker run -d --name signal-final \
    --entrypoint /bin/sleep \
    registry.gitlab.com/packaging/signal-cli/signal-cli-native:latest \
    infinity

sleep 2

echo ""
echo "=== Step 2: Link device ==="
docker exec -it signal-final signal-cli link -n LambdaSignalBot

echo ""
read -p "After scanning QR and seeing 'Associated with: +14192965521', press Enter..."

echo ""
echo "=== Step 3: Verify account ==="
docker exec signal-final signal-cli listAccounts

echo ""
echo "=== Step 4: Run receive to fully initialize account ==="
echo "This syncs data from your phone and fully registers the linked device..."
docker exec signal-final signal-cli receive --timeout 10

echo ""
echo "=== Step 5: List groups to get correct group IDs ==="
docker exec signal-final signal-cli -a +14192965521 listGroups

echo ""
echo "=== Step 6: Copy data from CORRECT location ==="
docker cp signal-final:/var/lib/signal-cli/.local/share/signal-cli "$SIGNAL_DIR/"

echo ""
echo "=== Step 7: Check extracted data ==="
ls -laR "$SIGNAL_DIR"

echo ""
echo "=== Step 8: Test with extracted data ==="
docker run --rm \
    -v "$SIGNAL_DIR:/root/.local/share/signal-cli" \
    registry.gitlab.com/packaging/signal-cli/signal-cli-native:latest \
    listAccounts

echo ""
echo "=== Cleanup ==="
docker rm -f signal-final

echo ""
echo "✅ SUCCESS! Data extracted to: $SIGNAL_DIR"
echo ""
echo "Now packaging for S3..."
cd "$SIGNAL_DIR"
tar -czf /tmp/signal-credentials.tar.gz data/

echo "Uploading to S3..."
aws s3 cp /tmp/signal-credentials.tar.gz s3://vehicle-monitoring-770171147232/signal-cli/credentials.tar.gz --region us-east-2

echo ""
echo "✅ COMPLETE! Signal credentials uploaded to S3"
