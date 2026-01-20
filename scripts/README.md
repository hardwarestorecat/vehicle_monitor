# Scripts Documentation

## Updating ICE Plates Database

### Quick Update (One Command)

When you get a new CSV export from the database:

```bash
./scripts/update-ice-plates.sh "/path/to/new/Plates-All Plates.csv"
```

Or if the CSV is already in the project directory:

```bash
./scripts/update-ice-plates.sh
```

This script will:
1. ✅ Convert CSV to JSON format
2. ✅ Upload to S3 (`config/ice-plates.json`)
3. ✅ Show statistics (total plates, confirmed, suspected)

The Lambda function will automatically load the new database on its next cold start (usually within a few minutes).

---

## Manual Process (If Needed)

If you prefer to do it step-by-step:

### Step 1: Convert CSV to JSON

```bash
# Make sure CSV is in project root as "Plates-All Plates.csv"
npx ts-node scripts/convert-csv-to-json.ts
```

Output: Creates `ice-plates.json` in project root

### Step 2: Upload to S3

```bash
export AWS_PROFILE=hardwarestorecat
aws s3 cp ice-plates.json \
  s3://vehicle-monitoring-captured-frames-770171147232/config/ice-plates.json \
  --region us-east-2
```

---

## CSV Format Requirements

The conversion script expects these columns:

- **Plate**: License plate number (required)
- **Plate Status**: Must be "Confirmed ICE" or "Highly suspected ICE" (required)
- **Plate Issuer**: State abbreviation (optional)
- **Tags**: Comma-separated tags (optional)
- **Plate Record Notes**: Additional notes (optional)

Any other status values will be skipped.

---

## Output Format

The JSON file has this structure:

```json
{
  "lastUpdated": "2026-01-19T22:15:00.000Z",
  "totalPlates": 3499,
  "confirmed": 2296,
  "suspected": 1203,
  "plates": {
    "ABC123": {
      "plateNumber": "ABC123",
      "status": "Confirmed ICE",
      "plateIssuer": "MN - Minnesota",
      "tags": ["ICE agent(s) seen in vehicle", "Tactical gear"],
      "notes": "Spotted multiple times"
    }
  }
}
```

---

## Troubleshooting

**CSV file not found:**
- Make sure the file path is correct
- Use quotes if the path has spaces: `"~/Downloads/Plates-All Plates.csv"`

**AWS upload fails:**
- Check AWS profile: `aws sts get-caller-identity --profile hardwarestorecat`
- Verify S3 bucket exists: `aws s3 ls s3://vehicle-monitoring-captured-frames-770171147232 --profile hardwarestorecat`

**Lambda not loading new database:**
- The Lambda loads the JSON on cold start
- It will pick up the new version within a few minutes
- To force immediate reload, update the Lambda function code or environment variables

---

## Future: API Integration

Once API access to defrostmn.net is available, this manual CSV process will be replaced with automatic syncing.
