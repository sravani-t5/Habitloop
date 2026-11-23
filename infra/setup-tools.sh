#!/usr/bin/env bash
# Installs AWS CLI v2 and Terraform in a Codespace / Ubuntu box.
set -euo pipefail
if ! command -v aws >/dev/null; then
  curl -sSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  unzip -q -o /tmp/awscliv2.zip -d /tmp && sudo /tmp/aws/install
fi
if ! command -v terraform >/dev/null; then
  V=1.9.8
  curl -sSL "https://releases.hashicorp.com/terraform/${V}/terraform_${V}_linux_amd64.zip" -o /tmp/tf.zip
  unzip -q -o /tmp/tf.zip -d /tmp && sudo mv /tmp/terraform /usr/local/bin/terraform
fi
aws --version; terraform version | head -1; docker --version
