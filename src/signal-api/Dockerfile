# Use AWS Lambda Python base image
FROM public.ecr.aws/lambda/python:3.11

# Install Java 17 (required for signal-cli)
RUN yum update -y && \
    yum install -y java-17-amazon-corretto wget tar gzip && \
    yum clean all

# Install signal-cli
ENV SIGNAL_CLI_VERSION=0.13.22
RUN cd /opt && \
    wget https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}-Linux.tar.gz && \
    tar xf signal-cli-${SIGNAL_CLI_VERSION}-Linux.tar.gz && \
    rm signal-cli-${SIGNAL_CLI_VERSION}-Linux.tar.gz && \
    ln -s /opt/signal-cli-${SIGNAL_CLI_VERSION}/bin/signal-cli /usr/local/bin/signal-cli

# Copy Lambda function code
COPY handler.py ${LAMBDA_TASK_ROOT}/
COPY requirements.txt ${LAMBDA_TASK_ROOT}/

# Install Python dependencies
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

# Set the Lambda handler
CMD ["handler.lambda_handler"]
