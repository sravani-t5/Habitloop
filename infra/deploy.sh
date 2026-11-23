#!/usr/bin/env bash
# Full deployment: ECR repos -> build & push images -> infrastructure -> frontend to S3/CloudFront.
# Needs AWS credentials in the environment (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TF="$ROOT/infra/terraform"
REGION=${AWS_DEFAULT_REGION:-ap-south-1}
SERVICES="user activity challenge integration analytics recommendation"

echo "==> Who am I?"; aws sts get-caller-identity --query '[Account,Arn]' --output text
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

echo "==> 1/5 Build the Lambda bundle"
(cd "$ROOT" && npm install --no-audit --no-fund >/dev/null && cd lambdas/event-processor && npm run bundle)

echo "==> 2/5 Create ECR repositories"
cd "$TF" && terraform init -input=false
terraform apply -input=false -auto-approve -target=aws_ecr_repository.svc

echo "==> 3/5 Build and push container images"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"
for s in $SERVICES; do
  docker build -t "$REGISTRY/habitloop/$s-service:latest" --build-arg SERVICE_DIR="services/$s-service" "$ROOT"
  docker push "$REGISTRY/habitloop/$s-service:latest"
done

echo "==> 4/5 Create all infrastructure (VPC, RDS, ECS, ALB, EventBridge, Lambda, CloudFront, CloudWatch)"
terraform apply -input=false -auto-approve

echo "==> 5/5 Build and upload the frontend"
BUCKET=$(terraform output -raw frontend_bucket); CF=$(terraform output -raw cloudfront_id)
(cd "$ROOT/frontend" && npm install --no-audit --no-fund >/dev/null && VITE_API_BASE=same-origin npm run build)
aws s3 sync "$ROOT/frontend/build" "s3://$BUCKET" --delete
aws cloudfront create-invalidation --distribution-id "$CF" --paths "/*" >/dev/null

echo; echo "DONE. Open: $(terraform output -raw app_url)"
echo "(first start takes 3-5 minutes: ECS tasks must pull images and create their databases)"
