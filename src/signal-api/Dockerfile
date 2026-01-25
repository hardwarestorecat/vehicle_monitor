# Use AWS Lambda Python 3.12 base image (uses Amazon Linux 2023 with GLIBC 2.34+)
FROM public.ecr.aws/lambda/python:3.12

# Install Java 21 (required for signal-cli)
# Download and install Amazon Corretto 21 directly
RUN dnf update -y && \
    dnf install -y wget tar gzip findutils && \
    wget https://corretto.aws/downloads/latest/amazon-corretto-21-x64-linux-jdk.tar.gz && \
    mkdir -p /usr/lib/jvm && \
    tar xzf amazon-corretto-21-x64-linux-jdk.tar.gz -C /usr/lib/jvm && \
    rm amazon-corretto-21-x64-linux-jdk.tar.gz && \
    JAVA_DIR=$(ls -d /usr/lib/jvm/amazon-corretto-21* | head -n 1) && \
    ln -sf $JAVA_DIR /usr/lib/jvm/java-21 && \
    dnf clean all

ENV JAVA_HOME=/usr/lib/jvm/java-21
ENV PATH=$JAVA_HOME/bin:$PATH

# Install signal-cli
ENV SIGNAL_CLI_VERSION=0.13.22
RUN cd /opt && \
    wget https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}.tar.gz && \
    tar xf signal-cli-${SIGNAL_CLI_VERSION}.tar.gz && \
    rm signal-cli-${SIGNAL_CLI_VERSION}.tar.gz && \
    ln -s /opt/signal-cli-${SIGNAL_CLI_VERSION}/bin/signal-cli /usr/local/bin/signal-cli

# Copy Lambda function code
COPY handler.py ${LAMBDA_TASK_ROOT}/
COPY requirements.txt ${LAMBDA_TASK_ROOT}/

# Install Python dependencies
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

# Set the Lambda handler
CMD ["handler.lambda_handler"]
