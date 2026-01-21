FROM python:3.11-slim

# Install system dependencies for OpenCV
RUN apt-get update && apt-get install -y \
    libopencv-dev \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install Python packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
# Note: YOLOv8 model will be downloaded on first run (6.2MB)
COPY stream_processor.py .

# Set environment variables (can be overridden at runtime)
ENV PYTHONUNBUFFERED=1
ENV CAMERA_ID=camera1
ENV AWS_REGION=us-east-2
ENV BUCKET_NAME=vehicle-monitoring-770171147232
ENV S3_PREFIX=vehicle_monitoring/captured/incoming/

# Run the stream processor
CMD ["python", "stream_processor.py"]
