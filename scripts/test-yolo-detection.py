#!/usr/bin/env python3
"""
Test YOLOv8 vehicle detection against existing S3 images
Downloads images from S3 and runs YOLO detection to evaluate accuracy
"""

import os
import boto3
from ultralytics import YOLO
import cv2
import numpy as np
from pathlib import Path

# Configuration
BUCKET_NAME = 'vehicle-monitoring-770171147232'
S3_PREFIXES = [
    'vehicle_monitoring/captured/confirmed/',
    'vehicle_monitoring/captured/standard/'
]
OUTPUT_DIR = '/tmp/yolo_test_results'
REGION = 'us-east-2'

# YOLO vehicle classes (COCO dataset)
VEHICLE_CLASSES = {
    2: 'car',
    3: 'motorcycle',
    5: 'bus',
    7: 'truck'
}

def download_images_from_s3():
    """Download all test images from S3"""
    s3 = boto3.client('s3', region_name=REGION)

    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    images_dir = os.path.join(OUTPUT_DIR, 'images')
    os.makedirs(images_dir, exist_ok=True)

    downloaded_images = []

    for prefix in S3_PREFIXES:
        print(f"\n📥 Downloading from s3://{BUCKET_NAME}/{prefix}...")

        # List objects
        response = s3.list_objects_v2(Bucket=BUCKET_NAME, Prefix=prefix)

        if 'Contents' not in response:
            print(f"  No images found in {prefix}")
            continue

        for obj in response['Contents']:
            key = obj['Key']

            # Skip directories
            if key.endswith('/'):
                continue

            # Download image
            filename = os.path.basename(key)
            local_path = os.path.join(images_dir, filename)

            print(f"  Downloading {filename}...")
            s3.download_file(BUCKET_NAME, key, local_path)
            downloaded_images.append(local_path)

    print(f"\n✅ Downloaded {len(downloaded_images)} images")
    return downloaded_images

def test_yolo_detection(image_paths):
    """Run YOLO detection on all images and generate report"""
    print("\n🚗 Loading YOLOv8-nano model...")
    model = YOLO('yolov8n.pt')  # Auto-downloads on first run (6MB)

    results_dir = os.path.join(OUTPUT_DIR, 'annotated')
    os.makedirs(results_dir, exist_ok=True)

    detection_results = []

    for i, image_path in enumerate(image_paths, 1):
        print(f"\n[{i}/{len(image_paths)}] Processing {os.path.basename(image_path)}...")

        # Load image
        image = cv2.imread(image_path)
        if image is None:
            print(f"  ❌ Failed to load image")
            continue

        # Run YOLO detection
        results = model(image, verbose=False)

        # Parse results
        vehicles_detected = []
        for result in results:
            boxes = result.boxes
            for box in boxes:
                class_id = int(box.cls[0])
                confidence = float(box.conf[0])

                # Check if it's a vehicle
                if class_id in VEHICLE_CLASSES:
                    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                    vehicles_detected.append({
                        'class': VEHICLE_CLASSES[class_id],
                        'confidence': confidence,
                        'bbox': (int(x1), int(y1), int(x2), int(y2))
                    })

                    # Draw bounding box
                    cv2.rectangle(
                        image,
                        (int(x1), int(y1)),
                        (int(x2), int(y2)),
                        (0, 255, 0),
                        2
                    )

                    # Draw label
                    label = f"{VEHICLE_CLASSES[class_id]} {confidence:.2f}"
                    cv2.putText(
                        image,
                        label,
                        (int(x1), int(y1) - 10),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.5,
                        (0, 255, 0),
                        2
                    )

        # Save annotated image
        output_path = os.path.join(results_dir, os.path.basename(image_path))
        cv2.imwrite(output_path, image)

        # Print results
        print(f"  ✅ Detected {len(vehicles_detected)} vehicle(s)")
        for vehicle in vehicles_detected:
            print(f"     - {vehicle['class']}: {vehicle['confidence']:.1%} confidence")

        detection_results.append({
            'image': os.path.basename(image_path),
            'vehicles': vehicles_detected,
            'vehicle_count': len(vehicles_detected)
        })

    return detection_results

def generate_report(detection_results):
    """Generate summary report"""
    print("\n" + "="*70)
    print("📊 YOLO DETECTION REPORT")
    print("="*70)

    total_images = len(detection_results)
    images_with_vehicles = sum(1 for r in detection_results if r['vehicle_count'] > 0)
    images_without_vehicles = total_images - images_with_vehicles
    total_vehicles = sum(r['vehicle_count'] for r in detection_results)

    print(f"\nTotal Images: {total_images}")
    print(f"Images with vehicles detected: {images_with_vehicles} ({images_with_vehicles/total_images*100:.1f}%)")
    print(f"Images without vehicles: {images_without_vehicles} ({images_without_vehicles/total_images*100:.1f}%)")
    print(f"Total vehicles detected: {total_vehicles}")
    print(f"Average vehicles per image: {total_vehicles/total_images:.2f}")

    print("\n" + "-"*70)
    print("Detailed Results:")
    print("-"*70)

    for result in detection_results:
        status = "✅" if result['vehicle_count'] > 0 else "❌"
        print(f"{status} {result['image']}: {result['vehicle_count']} vehicle(s)")
        for vehicle in result['vehicles']:
            print(f"     → {vehicle['class']}: {vehicle['confidence']:.1%}")

    print("\n" + "="*70)
    print(f"📁 Annotated images saved to: {os.path.join(OUTPUT_DIR, 'annotated')}")
    print("="*70)

    # Calculate statistics
    if images_with_vehicles > 0:
        detection_rate = images_with_vehicles / total_images * 100

        print(f"\n🎯 Detection Rate: {detection_rate:.1f}%")

        if detection_rate >= 95:
            print("   Excellent! YOLO is catching almost all vehicles.")
        elif detection_rate >= 85:
            print("   Good performance. Some edge cases may be missed.")
        elif detection_rate >= 70:
            print("   Moderate. Consider adjusting camera angles or lighting.")
        else:
            print("   ⚠️  Low detection rate. Image quality or angles may need improvement.")

    # False negatives check
    if images_without_vehicles > 0:
        print(f"\n⚠️  {images_without_vehicles} image(s) with NO vehicles detected")
        print("   These images either:")
        print("   - Are truly empty (good, will save Bedrock costs)")
        print("   - Have vehicles YOLO missed (false negatives)")
        print("   - Have poor image quality/angle")
        print("\n   👀 Review the annotated images to verify!")

def main():
    print("="*70)
    print("🧪 Testing YOLOv8-nano Vehicle Detection")
    print("="*70)

    # Step 1: Download images from S3
    image_paths = download_images_from_s3()

    if not image_paths:
        print("\n❌ No images found to test!")
        return

    # Step 2: Run YOLO detection
    detection_results = test_yolo_detection(image_paths)

    # Step 3: Generate report
    generate_report(detection_results)

    print("\n✅ Testing complete!")
    print(f"\nNext steps:")
    print(f"1. Review annotated images in: {os.path.join(OUTPUT_DIR, 'annotated')}")
    print(f"2. Verify detection accuracy")
    print(f"3. If good (>85%), proceed with YOLO pre-screening implementation")

if __name__ == '__main__':
    main()
