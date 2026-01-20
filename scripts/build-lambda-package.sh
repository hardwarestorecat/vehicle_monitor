#!/bin/bash
set -e

echo "Building Lambda deployment package..."

# Clean and create package directory
rm -rf lambda-package
mkdir -p lambda-package/image-processor

# Copy compiled JavaScript files with correct directory structure
echo "Copying compiled code..."
# Create nested structure to maintain relative import paths
mkdir -p lambda-package/image-processor/src/image-processor
cp -r dist/src/image-processor/* lambda-package/image-processor/src/image-processor/
cp -r dist/src/shared lambda-package/image-processor/src/shared
cp -r dist/lib lambda-package/image-processor/lib

# Create package.json for Lambda
cat > lambda-package/image-processor/package.json <<EOF
{
  "name": "image-processor",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "@aws-sdk/client-s3": "^3.490.0",
    "@aws-sdk/client-dynamodb": "^3.490.0",
    "@aws-sdk/client-textract": "^3.490.0",
    "@aws-sdk/client-bedrock-runtime": "^3.490.0",
    "@aws-sdk/lib-dynamodb": "^3.490.0",
    "uuid": "^9.0.1"
  }
}
EOF

# Install production dependencies
echo "Installing dependencies..."
cd lambda-package/image-processor
npm install --production --no-optional
cd ../..

echo "✅ Lambda package built successfully at: lambda-package/image-processor"
