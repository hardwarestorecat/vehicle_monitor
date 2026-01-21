import json
import os
import subprocess
import logging
import boto3
from typing import Dict, Any, Optional

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Environment variables
SIGNAL_CLI_CONFIG_DIR = os.environ.get('SIGNAL_CLI_CONFIG_DIR', '/mnt/efs/signal-cli')
SIGNAL_CREDENTIALS_SECRET = os.environ['SIGNAL_CREDENTIALS_SECRET']
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-2')

# AWS clients
secrets_client = boto3.client('secretsmanager', region_name=AWS_REGION)


def get_signal_credentials() -> Dict[str, str]:
    """Get Signal credentials from Secrets Manager"""
    try:
        response = secrets_client.get_secret_value(SecretId=SIGNAL_CREDENTIALS_SECRET)
        return json.loads(response['SecretString'])
    except Exception as e:
        logger.error(f"Failed to get Signal credentials: {str(e)}")
        raise


def extract_group_id_from_url(group_url: str) -> Optional[str]:
    """
    Extract group ID from Signal group URL
    Format: https://signal.group/#CjQKI...
    The group ID is the base64 string after the #
    """
    if not group_url or '#' not in group_url:
        return None
    return group_url.split('#')[1]


def format_alert_message(alert_data: Dict[str, Any]) -> str:
    """Format alert data into a readable Signal message"""
    plate_number = alert_data.get('plateNumber', 'UNKNOWN')
    plate_state = alert_data.get('plateState', '')
    location = alert_data.get('location', 'Unknown location')
    cross_street = alert_data.get('crossStreet', '')
    direction = alert_data.get('direction', '')
    timestamp = alert_data.get('timestamp', '')
    ice_status = alert_data.get('iceStatus', '')
    risk_score = alert_data.get('riskScore', 0)
    reasoning = alert_data.get('reasoning', '')

    # Build message
    lines = []
    lines.append(f"🚨 ICE VEHICLE ALERT 🚨")
    lines.append("")

    # Plate info
    if plate_state:
        lines.append(f"Plate: {plate_state} {plate_number}")
    else:
        lines.append(f"Plate: {plate_number}")

    # Location
    lines.append(f"Location: {location}")
    if cross_street:
        lines.append(f"Cross Street: {cross_street}")
    if direction:
        lines.append(f"Direction: {direction}")

    # Status
    lines.append("")
    lines.append(f"Status: {ice_status}")
    lines.append(f"Risk Score: {risk_score}/100")

    # Reasoning
    if reasoning:
        lines.append("")
        lines.append(f"Reason: {reasoning}")

    # Timestamp
    if timestamp:
        lines.append("")
        lines.append(f"Time: {timestamp}")

    return "\n".join(lines)


def send_signal_message(phone_number: str, recipient: str, message: str, is_group: bool = False) -> bool:
    """
    Send Signal message using signal-cli

    Args:
        phone_number: The Signal account phone number (sender)
        recipient: Phone number or group ID (recipient)
        message: Message text to send
        is_group: True if recipient is a group ID

    Returns:
        True if successful, False otherwise
    """
    try:
        # Build signal-cli command
        cmd = [
            'signal-cli',
            '--config', SIGNAL_CLI_CONFIG_DIR,
            '-a', phone_number,
            'send',
        ]

        if is_group:
            cmd.extend(['-g', recipient])
        else:
            cmd.append(recipient)

        cmd.extend(['-m', message])

        logger.info(f"Executing signal-cli command (group={is_group})")

        # Run signal-cli
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode == 0:
            logger.info(f"Signal message sent successfully")
            logger.info(f"stdout: {result.stdout}")
            return True
        else:
            logger.error(f"signal-cli failed with code {result.returncode}")
            logger.error(f"stdout: {result.stdout}")
            logger.error(f"stderr: {result.stderr}")
            return False

    except subprocess.TimeoutExpired:
        logger.error("signal-cli command timed out")
        return False
    except Exception as e:
        logger.error(f"Error sending Signal message: {str(e)}")
        return False


def handle_registration_action(action: str, phone_number: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """Handle Signal account registration actions"""
    try:
        if action == 'register':
            # Register account (step 1 - may need captcha)
            captcha = data.get('captcha')
            cmd = [
                'signal-cli',
                '--config', SIGNAL_CLI_CONFIG_DIR,
                '-a', phone_number,
                'register'
            ]
            if captcha:
                cmd.extend(['--captcha', captcha])

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

            return {
                'success': result.returncode == 0,
                'stdout': result.stdout,
                'stderr': result.stderr,
                'message': 'Registration initiated. Solve captcha at https://signalcaptchas.org/registration/generate.html'
            }

        elif action == 'verify':
            # Verify account with code
            code = data.get('code')
            if not code:
                return {'success': False, 'message': 'Verification code required'}

            cmd = [
                'signal-cli',
                '--config', SIGNAL_CLI_CONFIG_DIR,
                '-a', phone_number,
                'verify',
                code
            ]

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

            return {
                'success': result.returncode == 0,
                'stdout': result.stdout,
                'stderr': result.stderr,
                'message': 'Account verified' if result.returncode == 0 else 'Verification failed'
            }

        elif action == 'joinGroup':
            # Join Signal group from URL
            credentials = get_signal_credentials()
            group_url = credentials.get('groupUrl')

            if not group_url:
                return {'success': False, 'message': 'No group URL in credentials'}

            cmd = [
                'signal-cli',
                '--config', SIGNAL_CLI_CONFIG_DIR,
                '-a', phone_number,
                'joinGroup',
                '--uri', group_url
            ]

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

            return {
                'success': result.returncode == 0,
                'stdout': result.stdout,
                'stderr': result.stderr,
                'message': 'Joined group' if result.returncode == 0 else 'Failed to join group'
            }

        elif action == 'test':
            # Send test message
            credentials = get_signal_credentials()
            group_url = credentials.get('groupUrl')

            if group_url:
                group_id = extract_group_id_from_url(group_url)
                if group_id:
                    success = send_signal_message(
                        phone_number=phone_number,
                        recipient=group_id,
                        message="🧪 Test message from ICE Vehicle Monitoring System\n\nIf you see this, Signal integration is working!",
                        is_group=True
                    )
                    return {
                        'success': success,
                        'message': 'Test message sent' if success else 'Failed to send test message'
                    }

            return {'success': False, 'message': 'No group configured'}

        else:
            return {'success': False, 'message': f'Unknown action: {action}'}

    except Exception as e:
        logger.error(f"Registration action error: {str(e)}")
        return {'success': False, 'message': str(e)}


def lambda_handler(event, context):
    """
    Lambda handler for Signal API

    Registration actions:
    - {"action": "register"} or {"action": "register", "captcha": "signalcaptcha://..."}
    - {"action": "verify", "code": "123-456"}
    - {"action": "joinGroup"}
    - {"action": "test"}

    Alert request body:
    {
        "plateNumber": "ABC123",
        "plateState": "OH",
        "location": "Main St & 5th Ave",
        "crossStreet": "5th Avenue",
        "direction": "Northbound",
        "timestamp": "2026-01-20T12:34:56Z",
        "iceStatus": "Confirmed ICE",
        "riskScore": 95,
        "reasoning": "Plate found in known ICE database",
        "imageS3Key": "path/to/image.jpg",
        "groupType": "main"
    }
    """
    logger.info("Signal API Lambda invoked")
    logger.info(f"Event: {json.dumps(event)}")

    try:
        # Parse request body
        if 'body' in event:
            body = json.loads(event['body'])
        else:
            body = event

        logger.info(f"Parsed body: {json.dumps(body)}")

        # Get Signal credentials
        credentials = get_signal_credentials()
        phone_number = credentials.get('phoneNumber')

        if not phone_number:
            raise ValueError("Phone number not found in credentials")

        # Check if this is a registration action
        action = body.get('action')
        if action:
            result = handle_registration_action(action, phone_number, body)
            return {
                'statusCode': 200 if result.get('success') else 500,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps(result)
            }

        # Otherwise, handle as normal alert

        # Get Signal credentials
        credentials = get_signal_credentials()
        phone_number = credentials.get('phoneNumber')
        group_url = credentials.get('groupUrl')

        if not phone_number:
            raise ValueError("Phone number not found in credentials")

        # Format the alert message
        message = format_alert_message(body)
        logger.info(f"Formatted message:\n{message}")

        # Send to group if we have a group URL
        success = False
        if group_url:
            group_id = extract_group_id_from_url(group_url)
            if group_id:
                logger.info(f"Sending to Signal group")
                success = send_signal_message(
                    phone_number=phone_number,
                    recipient=group_id,
                    message=message,
                    is_group=True
                )
            else:
                logger.error("Failed to extract group ID from group URL")
        else:
            logger.warning("No group URL configured, message not sent")

        # Return response
        if success:
            return {
                'statusCode': 200,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({
                    'success': True,
                    'message': 'Signal alert sent successfully',
                    'data': body
                })
            }
        else:
            return {
                'statusCode': 500,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({
                    'success': False,
                    'message': 'Failed to send Signal alert',
                    'data': body
                })
            }

    except Exception as e:
        logger.error(f"Error: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': str(e)})
        }
