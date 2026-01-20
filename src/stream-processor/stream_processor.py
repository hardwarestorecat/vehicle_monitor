#!/usr/bin/env python3
"""
Vehicle Monitoring Stream Processor
Captures frames from RTSP cameras with intelligent motion detection and deduplication
"""

import os
import json
import time
import logging
from datetime import datetime
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass
import cv2
import numpy as np
from ultralytics import YOLO
import imagehash
from PIL import Image
import boto3
from io import BytesIO

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Environment variables
BUCKET_NAME = os.environ.get('BUCKET_NAME', 'vehicle-monitoring-770171147232')
S3_PREFIX = os.environ.get('S3_PREFIX', 'vehicle_monitoring/captured/incoming/')
CAMERA_ID = os.environ.get('CAMERA_ID', 'camera1')
RTSP_URL = os.environ.get('RTSP_URL', '')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-2')

# Detection parameters
CAPTURE_INTERVAL_SECONDS = 2.0  # Minimum 2 seconds between captures
MOTION_THRESHOLD = 0.05  # 5% of frame must have motion
VEHICLE_CONFIDENCE_THRESHOLD = 0.6  # 60% confidence for YOLO detections
HASH_SIMILARITY_THRESHOLD = 0.85  # 85% similar = duplicate
MAX_RECENT_HASHES = 30  # Keep last 30 hashes (covers 60 seconds at 2s intervals)

# YOLO vehicle classes (COCO dataset)
VEHICLE_CLASSES = {
    2: 'car',
    3: 'motorcycle',
    5: 'bus',
    7: 'truck'
}

@dataclass
class CameraROI:
    """Region of Interest for optimal plate capture"""
    x: float  # Normalized x position (0-1)
    y: float  # Normalized y position (0-1)
    width: float  # Normalized width (0-1)
    height: float  # Normalized height (0-1)


@dataclass
class VehicleDetection:
    """Vehicle detection result"""
    class_name: str
    confidence: float
    bbox: Tuple[int, int, int, int]  # x1, y1, x2, y2
    in_roi: bool


class SmartVehicleCapture:
    """Intelligent vehicle capture with motion detection and deduplication"""

    def __init__(
        self,
        camera_id: str,
        rtsp_url: str,
        bucket_name: str,
        s3_prefix: str,
        roi: Optional[CameraROI] = None
    ):
        self.camera_id = camera_id
        self.rtsp_url = rtsp_url
        self.bucket_name = bucket_name
        self.s3_prefix = s3_prefix

        # Default ROI: center 40% of frame
        self.roi = roi or CameraROI(x=0.3, y=0.35, width=0.4, height=0.3)

        # Initialize YOLO model
        logger.info("Loading YOLOv8-nano model...")
        self.vehicle_detector = YOLO('yolov8n.pt')
        logger.info("✅ YOLO model loaded")

        # Background subtractor for motion detection
        self.bg_subtractor = cv2.createBackgroundSubtractorMOG2(
            history=500,
            varThreshold=16,
            detectShadows=True
        )

        # Perceptual hash cache for deduplication
        self.recent_hashes: List[imagehash.ImageHash] = []

        # S3 client
        self.s3_client = boto3.client('s3', region_name=AWS_REGION)

        # Timing
        self.last_capture_time = 0
        self.frames_since_last_capture = 0

        # Statistics
        self.stats = {
            'frames_processed': 0,
            'motion_detected': 0,
            'vehicles_detected': 0,
            'vehicles_in_roi': 0,
            'duplicates_filtered': 0,
            'captures_uploaded': 0,
            'errors': 0
        }

    def has_significant_motion(self, frame: np.ndarray) -> bool:
        """
        Layer 1: Fast motion detection using background subtraction
        Returns: True if significant motion detected
        Cost: FREE, ~1ms
        """
        fg_mask = self.bg_subtractor.apply(frame)

        # Count white pixels (motion)
        motion_pixels = cv2.countNonZero(fg_mask)
        total_pixels = fg_mask.shape[0] * fg_mask.shape[1]
        motion_percentage = motion_pixels / total_pixels

        return motion_percentage > MOTION_THRESHOLD

    def detect_vehicles_yolo(self, frame: np.ndarray) -> List[VehicleDetection]:
        """
        Layer 2: Local vehicle detection using YOLOv8-nano
        Returns: List of detected vehicles
        Cost: FREE, runs locally ~50-100ms on CPU
        """
        # Run inference
        results = self.vehicle_detector(frame, verbose=False)

        vehicles = []
        h, w = frame.shape[:2]

        for result in results:
            boxes = result.boxes
            for box in boxes:
                # Get class ID and confidence
                class_id = int(box.cls[0])
                confidence = float(box.conf[0])

                # Filter: only vehicles with sufficient confidence
                if class_id in VEHICLE_CLASSES and confidence > VEHICLE_CONFIDENCE_THRESHOLD:
                    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                    bbox = (int(x1), int(y1), int(x2), int(y2))

                    # Check if vehicle center is in ROI
                    center_x = (x1 + x2) / 2
                    center_y = (y1 + y2) / 2
                    in_roi = self.is_in_capture_zone(center_x, center_y, w, h)

                    vehicles.append(VehicleDetection(
                        class_name=VEHICLE_CLASSES[class_id],
                        confidence=confidence,
                        bbox=bbox,
                        in_roi=in_roi
                    ))

        return vehicles

    def is_in_capture_zone(
        self,
        center_x: float,
        center_y: float,
        frame_width: int,
        frame_height: int
    ) -> bool:
        """Check if point is in the optimal plate capture zone"""
        roi_x_min = frame_width * self.roi.x
        roi_x_max = frame_width * (self.roi.x + self.roi.width)
        roi_y_min = frame_height * self.roi.y
        roi_y_max = frame_height * (self.roi.y + self.roi.height)

        return (roi_x_min <= center_x <= roi_x_max and
                roi_y_min <= center_y <= roi_y_max)

    def is_duplicate_vehicle(self, vehicle_frame: np.ndarray) -> bool:
        """
        Layer 3: Perceptual hash comparison to detect duplicate captures
        Returns: True if frame is very similar to recent captures
        Cost: FREE, ~10ms per comparison
        """
        # Convert to PIL Image for hashing
        pil_image = Image.fromarray(cv2.cvtColor(vehicle_frame, cv2.COLOR_BGR2RGB))

        # Generate perceptual hash
        current_hash = imagehash.phash(pil_image, hash_size=16)

        # Compare to recent captures
        for recent_hash in self.recent_hashes:
            # Calculate similarity (0 = identical, 256 = completely different)
            hash_diff = current_hash - recent_hash
            similarity = 1 - (hash_diff / 256.0)

            if similarity > HASH_SIMILARITY_THRESHOLD:
                # This is a duplicate
                logger.debug(f"Duplicate detected: {similarity:.1%} similar")
                return True

        # Not a duplicate - add to cache
        self.recent_hashes.append(current_hash)

        # Keep only recent hashes
        if len(self.recent_hashes) > MAX_RECENT_HASHES:
            self.recent_hashes.pop(0)

        return False

    def extract_vehicle_region(
        self,
        frame: np.ndarray,
        vehicle: VehicleDetection,
        padding: float = 0.2
    ) -> np.ndarray:
        """Extract vehicle region with padding"""
        x1, y1, x2, y2 = vehicle.bbox
        h, w = frame.shape[:2]

        # Add padding
        x_pad = int((x2 - x1) * padding)
        y_pad = int((y2 - y1) * padding)

        x1 = max(0, x1 - x_pad)
        y1 = max(0, y1 - y_pad)
        x2 = min(w, x2 + x_pad)
        y2 = min(h, y2 + y_pad)

        return frame[y1:y2, x1:x2]

    def upload_to_s3(self, frame: np.ndarray) -> bool:
        """Upload frame to S3 for processing by image processor Lambda"""
        try:
            # Generate filename with timestamp
            timestamp = datetime.utcnow().strftime('%Y-%m-%dT%H-%M-%S-%f')[:-3]
            filename = f"{self.camera_id}_{timestamp}.jpg"
            s3_key = f"{self.s3_prefix}{self.camera_id}/{filename}"

            # Encode frame as JPEG
            _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
            image_bytes = BytesIO(buffer.tobytes())

            # Upload to S3
            self.s3_client.upload_fileobj(
                image_bytes,
                self.bucket_name,
                s3_key,
                ExtraArgs={'ContentType': 'image/jpeg'}
            )

            logger.info(f"✅ Uploaded: s3://{self.bucket_name}/{s3_key}")
            self.stats['captures_uploaded'] += 1
            return True

        except Exception as e:
            logger.error(f"❌ S3 upload failed: {e}")
            self.stats['errors'] += 1
            return False

    def process_frame(self, frame: np.ndarray) -> bool:
        """
        Process a single frame through the 3-layer filtering pipeline
        Returns: True if frame was uploaded
        """
        self.stats['frames_processed'] += 1
        self.frames_since_last_capture += 1

        # ═══════════════════════════════════════════════════════
        # LAYER 1: Motion Detection (FREE, ~1ms)
        # ═══════════════════════════════════════════════════════
        if not self.has_significant_motion(frame):
            return False

        self.stats['motion_detected'] += 1

        # ═══════════════════════════════════════════════════════
        # LAYER 2: YOLO Vehicle Detection (FREE, ~50-100ms)
        # ═══════════════════════════════════════════════════════
        vehicles = self.detect_vehicles_yolo(frame)

        if not vehicles:
            return False

        self.stats['vehicles_detected'] += 1

        # Find vehicle in ROI
        vehicle_in_roi = None
        for vehicle in vehicles:
            if vehicle.in_roi:
                vehicle_in_roi = vehicle
                break

        if not vehicle_in_roi:
            logger.debug(f"Vehicle detected but not in ROI")
            return False

        self.stats['vehicles_in_roi'] += 1

        # ═══════════════════════════════════════════════════════
        # TIMING: Minimum 2 seconds between captures
        # ═══════════════════════════════════════════════════════
        current_time = time.time()
        time_since_last_capture = current_time - self.last_capture_time

        if time_since_last_capture < CAPTURE_INTERVAL_SECONDS:
            logger.debug(
                f"Too soon: {time_since_last_capture:.1f}s < "
                f"{CAPTURE_INTERVAL_SECONDS}s"
            )
            return False

        # ═══════════════════════════════════════════════════════
        # LAYER 3: Perceptual Hash Deduplication (FREE, ~10ms)
        # ═══════════════════════════════════════════════════════
        vehicle_frame = self.extract_vehicle_region(frame, vehicle_in_roi)

        if self.is_duplicate_vehicle(vehicle_frame):
            self.stats['duplicates_filtered'] += 1
            logger.info(
                f"Duplicate vehicle filtered "
                f"({self.stats['duplicates_filtered']} total)"
            )
            return False

        # ═══════════════════════════════════════════════════════
        # PASSED ALL CHECKS - Upload to S3
        # ═══════════════════════════════════════════════════════
        logger.info(
            f"✓ New vehicle detected: {vehicle_in_roi.class_name} "
            f"({vehicle_in_roi.confidence:.1%} confidence)"
        )

        success = self.upload_to_s3(vehicle_frame)
        if success:
            self.last_capture_time = current_time
            self.frames_since_last_capture = 0

        return success

    def run(self):
        """Main processing loop"""
        logger.info("="*70)
        logger.info(f"🚗 Starting Stream Processor")
        logger.info(f"Camera ID: {self.camera_id}")
        logger.info(f"RTSP URL: {self.rtsp_url}")
        logger.info(f"S3 Bucket: s3://{self.bucket_name}/{self.s3_prefix}")
        logger.info(f"Capture Interval: {CAPTURE_INTERVAL_SECONDS}s")
        logger.info(f"ROI: x={self.roi.x}, y={self.roi.y}, "
                   f"w={self.roi.width}, h={self.roi.height}")
        logger.info("="*70)

        # Open RTSP stream
        cap = cv2.VideoCapture(self.rtsp_url)

        if not cap.isOpened():
            logger.error(f"❌ Failed to open RTSP stream: {self.rtsp_url}")
            return

        logger.info("✅ RTSP stream opened")

        frame_count = 0
        last_stats_time = time.time()

        try:
            while True:
                ret, frame = cap.read()

                if not ret:
                    logger.warning("Failed to read frame, reconnecting...")
                    time.sleep(5)
                    cap = cv2.VideoCapture(self.rtsp_url)
                    continue

                frame_count += 1

                # Process every 3rd frame (30 FPS → 10 FPS)
                if frame_count % 3 != 0:
                    continue

                # Process frame
                self.process_frame(frame)

                # Print stats every 60 seconds
                current_time = time.time()
                if current_time - last_stats_time >= 60:
                    self.print_stats()
                    last_stats_time = current_time

        except KeyboardInterrupt:
            logger.info("\n⚠️  Shutting down...")
        except Exception as e:
            logger.error(f"❌ Error: {e}", exc_info=True)
        finally:
            cap.release()
            self.print_stats()
            logger.info("✅ Stream processor stopped")

    def print_stats(self):
        """Print processing statistics"""
        logger.info("="*70)
        logger.info("📊 Statistics:")
        logger.info(f"   Frames processed: {self.stats['frames_processed']}")
        logger.info(f"   Motion detected: {self.stats['motion_detected']}")
        logger.info(f"   Vehicles detected: {self.stats['vehicles_detected']}")
        logger.info(f"   Vehicles in ROI: {self.stats['vehicles_in_roi']}")
        logger.info(f"   Duplicates filtered: {self.stats['duplicates_filtered']}")
        logger.info(f"   Captures uploaded: {self.stats['captures_uploaded']}")
        logger.info(f"   Errors: {self.stats['errors']}")

        if self.stats['vehicles_detected'] > 0:
            roi_rate = (self.stats['vehicles_in_roi'] /
                       self.stats['vehicles_detected'] * 100)
            logger.info(f"   ROI capture rate: {roi_rate:.1f}%")

        if self.stats['vehicles_in_roi'] > 0:
            dedup_rate = (self.stats['duplicates_filtered'] /
                         self.stats['vehicles_in_roi'] * 100)
            logger.info(f"   Deduplication rate: {dedup_rate:.1f}%")

        logger.info("="*70)


def load_camera_config() -> Dict:
    """Load camera configuration from Secrets Manager"""
    try:
        secrets_client = boto3.client('secretsmanager', region_name=AWS_REGION)
        response = secrets_client.get_secret_value(
            SecretId='vehicle-monitoring/camera-credentials'
        )
        config = json.loads(response['SecretString'])

        # Find config for this camera
        for camera_config in config.get('cameras', []):
            if camera_config.get('cameraId') == CAMERA_ID:
                return camera_config

        logger.warning(f"No config found for {CAMERA_ID}, using defaults")
        return {}

    except Exception as e:
        logger.warning(f"Failed to load camera config: {e}")
        return {}


def main():
    """Entry point"""
    # Load camera configuration
    camera_config = load_camera_config()

    # Get RTSP URL (from config or environment)
    rtsp_url = camera_config.get('rtspUrl') or RTSP_URL

    if not rtsp_url:
        logger.error("❌ No RTSP URL configured!")
        logger.error("Set RTSP_URL environment variable or configure in Secrets Manager")
        return

    # Get ROI configuration
    roi_config = camera_config.get('motionDetection', {}).get('plateROI', {})
    roi = None
    if roi_config:
        roi = CameraROI(
            x=roi_config.get('x', 0.3),
            y=roi_config.get('y', 0.35),
            width=roi_config.get('width', 0.4),
            height=roi_config.get('height', 0.3)
        )

    # Initialize and run processor
    processor = SmartVehicleCapture(
        camera_id=CAMERA_ID,
        rtsp_url=rtsp_url,
        bucket_name=BUCKET_NAME,
        s3_prefix=S3_PREFIX,
        roi=roi
    )

    processor.run()


if __name__ == '__main__':
    main()
