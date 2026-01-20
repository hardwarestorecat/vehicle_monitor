# Testing YOLO Vehicle Detection

This script will test YOLOv8-nano against your existing 16 images in S3 to see how well it detects vehicles.

## What This Test Does

1. Downloads all images from S3 (confirmed + standard folders)
2. Runs YOLO vehicle detection on each image
3. Generates annotated images with bounding boxes
4. Creates a report showing:
   - Detection rate (% of images with vehicles detected)
   - Confidence scores for each detection
   - False negatives (images where YOLO missed vehicles)

## Installation

```bash
# Install Python dependencies
python3 -m pip install -r scripts/requirements-yolo.txt

# OR if you need to install pip first:
sudo apt-get update && sudo apt-get install python3-pip
python3 -m pip install -r scripts/requirements-yolo.txt
```

## Run Test

```bash
cd /home/pajka/Coding/ice_machine
python3 scripts/test-yolo-detection.py
```

## Expected Output

```
🧪 Testing YOLOv8-nano Vehicle Detection
======================================================================

📥 Downloading from s3://vehicle-monitoring-770171147232/...
  Downloading image1.jpg...
  Downloading image2.jpg...
  ...

✅ Downloaded 16 images

🚗 Loading YOLOv8-nano model...
  (First run will auto-download 6MB model)

[1/16] Processing image1.jpg...
  ✅ Detected 1 vehicle(s)
     - car: 94.3% confidence

[2/16] Processing image2.jpg...
  ✅ Detected 2 vehicle(s)
     - truck: 89.1% confidence
     - car: 91.5% confidence

...

======================================================================
📊 YOLO DETECTION REPORT
======================================================================

Total Images: 16
Images with vehicles detected: 15 (93.8%)
Images without vehicles: 1 (6.3%)
Total vehicles detected: 18
Average vehicles per image: 1.13

----------------------------------------------------------------------
Detailed Results:
----------------------------------------------------------------------
✅ image1.jpg: 1 vehicle(s)
     → car: 94.3%
✅ image2.jpg: 2 vehicle(s)
     → truck: 89.1%
     → car: 91.5%
...

======================================================================
📁 Annotated images saved to: /tmp/yolo_test_results/annotated
======================================================================

🎯 Detection Rate: 93.8%
   Excellent! YOLO is catching almost all vehicles.

✅ Testing complete!
```

## Interpreting Results

### Detection Rate Benchmarks:
- **95%+**: Excellent - YOLO will work great for pre-screening
- **85-95%**: Good - Some edge cases may be missed but overall solid
- **70-85%**: Moderate - May need camera angle/lighting adjustments
- **<70%**: Low - Image quality issues or camera positioning needs work

### What to Check:
1. **Review annotated images** in `/tmp/yolo_test_results/annotated/`
   - Green boxes = detected vehicles
   - Look for missed vehicles (false negatives)
   - Check if bounding boxes are accurate

2. **Confidence scores**
   - 80%+ = High confidence
   - 60-80% = Moderate (acceptable)
   - <60% = Low (we filter these out anyway)

3. **False negatives**
   - If YOLO missed vehicles, check why:
     - Partially visible? (normal, acceptable)
     - Small/distant? (adjust camera zoom)
     - Obscured? (lighting/angle issue)
     - Poor image quality? (camera settings)

## Expected YOLO Performance

Based on your fixed intersection camera setup:

**Good Detection (should catch):**
- ✅ Cars (90-95% detection rate)
- ✅ Trucks (85-90%)
- ✅ SUVs (90-95%)
- ✅ Vans (85-90%)

**Moderate Detection:**
- ⚠️ Motorcycles (75-85%)
- ⚠️ Partially visible vehicles (70-80%)

**May Miss:**
- ❌ Very distant vehicles (depends on camera zoom)
- ❌ Heavy rain/fog conditions (70-80% detection)
- ❌ Extreme angles (side/rear views only)

## Next Steps

After running the test:

### If detection rate is >85%:
✅ **Proceed with YOLO implementation**
- YOLO will save you ~$140/year in Bedrock costs
- Minimal false negatives
- Good pre-screening before expensive AI calls

### If detection rate is 70-85%:
⚠️ **Adjust camera settings first**
- Check camera angle (should be 30-45° from horizontal)
- Verify camera is focused on the "sweet spot" where plates are readable
- Test different camera zoom levels
- Improve lighting if needed

### If detection rate is <70%:
❌ **Skip YOLO pre-screening for now**
- Too many false negatives
- Send all frames to Bedrock (costs more but catches everything)
- Focus on camera positioning/quality improvements first

## Cost Savings Calculation

If YOLO achieves 85%+ detection with 50% duplicate filtering:

```
Without YOLO:
- 64,800 Bedrock calls/month
- Cost: $25.92/month

With YOLO:
- 35,640 Bedrock calls/month (45% filtered)
- Cost: $14.26/month
- Savings: $11.66/month ($140/year)
```

Plus:
- Reduced S3 storage costs
- Reduced Lambda execution time
- Faster processing (no AI calls for duplicates)

## Questions?

- **What if YOLO detects 0 vehicles in an image that clearly has one?**
  - False negative - check image quality, angle, or lighting
  - Review annotated image to see what YOLO "saw"

- **What if YOLO detects vehicles when there are none?**
  - False positive - but Bedrock will correct this (no plate detected = deleted)
  - Not a big issue since we have two layers of validation

- **Should I adjust the confidence threshold?**
  - Default is 60% (box.conf > 0.6)
  - Lower = more detections but more false positives
  - Higher = fewer false positives but more false negatives
  - 60% is a good balance

## Files Created

```
scripts/
├── test-yolo-detection.py      # Test script
├── requirements-yolo.txt       # Python dependencies
└── TEST-YOLO-README.md        # This file

Output:
/tmp/yolo_test_results/
├── images/                     # Downloaded S3 images
└── annotated/                  # Images with bounding boxes
```

---

**Ready to test?** Just run:
```bash
python3 scripts/test-yolo-detection.py
```
