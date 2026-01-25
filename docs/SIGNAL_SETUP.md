# Signal Integration Setup - Working Solution

## Overview
This document describes the exact steps that worked to set up Signal messaging for the ICE Vehicle Monitoring System.

## Problem
signal-cli stores account data in `/var/lib/signal-cli/.local/share/signal-cli/` inside the container, NOT in `/root/.local/share/signal-cli/` as initially expected. This caused multiple failures until we discovered the correct path.

## Solution

### 1. Link Signal Account

Use the script: `/home/pajka/Coding/ice_machine/scripts/link-and-extract-correct.sh`

```bash
sudo bash /home/pajka/Coding/ice_machine/scripts/link-and-extract-correct.sh
```

This script:
1. Starts a signal-cli container with `sleep infinity` to keep it running
2. Executes `signal-cli link -n LambdaSignalBot` inside the container
3. Generates a QR code link like `sgnl://linkdevice?uuid=...`
4. Waits for you to scan the QR code with Signal on your phone (+14192965521)
5. Verifies the account with `signal-cli listAccounts`
6. **CRITICAL**: Runs `signal-cli receive --timeout 10` to fully initialize the linked device and sync data from your phone
7. Lists groups with `signal-cli listGroups` to get the correct internal group IDs
8. Copies data from the CORRECT location: `/var/lib/signal-cli/.local/share/signal-cli/`
9. Packages and uploads to S3: `s3://vehicle-monitoring-770171147232/signal-cli/credentials.tar.gz`

### 2. Scan QR Code

When the script outputs a `sgnl://` link:
1. Go to https://www.qr-code-generator.com/
2. Paste the `sgnl://` link
3. Generate QR code
4. On your phone: Signal → Settings → Linked Devices → + (Link New Device)
5. Scan the QR code
6. Wait for "Associated with: +14192965521" message
7. Press Enter in the terminal

### 3. Upload to S3

The script automatically packages the credentials:
```bash
cd /root/.local/share/signal-cli-working/signal-cli
tar -czf /tmp/signal-credentials.tar.gz data/
aws s3 cp /tmp/signal-credentials.tar.gz s3://vehicle-monitoring-770171147232/signal-cli/credentials.tar.gz --region us-east-2
```

### 4. Fix Group ID Encoding

The Lambda handler needed a fix to convert URL-safe base64 to standard base64.

In `/home/pajka/Coding/ice_machine/src/signal-api/handler.py`:

```python
def extract_group_id_from_url(group_url: str) -> Optional[str]:
    """
    Extract group ID from Signal group URL
    Format: https://signal.group/#CjQKI...
    The group ID is the URL-safe base64 string after the #
    Convert to standard base64 for signal-cli
    """
    if not group_url or '#' not in group_url:
        return None

    # Get the URL-safe base64 string after the #
    url_safe_b64 = group_url.split('#')[1]

    # Convert URL-safe base64 to standard base64
    # Replace - with + and _ with /
    standard_b64 = url_safe_b64.replace('-', '+').replace('_', '/')

    return standard_b64
```

### 5. Rebuild and Deploy Lambda

```bash
cd /home/pajka/Coding/ice_machine/src/signal-api

# Login to ECR
aws ecr get-login-password --region us-east-2 | docker login --username AWS --password-stdin 770171147232.dkr.ecr.us-east-2.amazonaws.com

# Build image
docker build -t 770171147232.dkr.ecr.us-east-2.amazonaws.com/vehicle-monitoring-signal-api:latest .

# Push to ECR
docker push 770171147232.dkr.ecr.us-east-2.amazonaws.com/vehicle-monitoring-signal-api:latest

# Update Lambda
aws lambda update-function-code \
    --function-name VehicleMonitoringAlertSta-SignalApiFunction68C38E4-QFod2rioE5xb \
    --region us-east-2 \
    --image-uri 770171147232.dkr.ecr.us-east-2.amazonaws.com/vehicle-monitoring-signal-api:latest
```

### 6. Test

```bash
aws lambda invoke \
    --function-name VehicleMonitoringAlertSta-SignalApiFunction68C38E4-QFod2rioE5xb \
    --region us-east-2 \
    --cli-binary-format raw-in-base64-out \
    --payload '{"action": "test"}' \
    /tmp/signal-test-response.json && cat /tmp/signal-test-response.json
```

Check your Signal group for the test message.

## Key Lessons Learned

1. **signal-cli data location**: Data is stored in `/var/lib/signal-cli/.local/share/signal-cli/` NOT `/root/.local/share/signal-cli/`
2. **Container persistence**: Must keep container running (with `sleep infinity`) and exec commands inside it
3. **Base64 encoding**: Signal group URLs use URL-safe base64 (with - and _) but signal-cli expects standard base64 (with + and /)
4. **Phone number**: Use +14192965521 for the Signal account (linked device to your phone)

## Files Created

- `/home/pajka/Coding/ice_machine/scripts/link-and-extract-correct.sh` - Working linking script
- `/root/.local/share/signal-cli-working/` - Extracted credentials (local backup)
- `s3://vehicle-monitoring-770171147232/signal-cli/credentials.tar.gz` - Uploaded credentials for Lambda

## Configuration

Secrets Manager secret: `vehicle-monitoring/signal-credentials`
```json
{
  "phoneNumber": "+14192965521",
  "username": "girthpigeon.99",
  "groupUrl": "https://signal.group/#CjQKIGhkjG1V-4_YSMT7yYfFFvKgqRh2QuS0_lRy3Rh-CjkXEhCu9pIGeT284fzMapb7MsDH"
}
```

## Next Steps

Now that Signal is working, the image processor can call the Signal API to send alerts. The connection needs to be wired up in the ImageProcessorStack to pass the Signal API URL.
