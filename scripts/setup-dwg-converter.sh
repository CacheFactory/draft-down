#!/usr/bin/env bash
# Provision the DWG↔DXF converter: LibreDWG in a Lambda container image
# behind a public Function URL. Idempotent; rebuilds+redeploys the image each
# run. Requires Docker.
# Usage: ./scripts/setup-dwg-converter.sh

set -euo pipefail

REGION="us-east-1"
FUNC="draftdown-dwg-converter"
ROLE="draftdown-dwg-converter-lambda"
REPO="draftdown-dwg-converter"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
ECR="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> ECR repository..."
aws ecr describe-repositories --region "$REGION" --repository-names "$REPO" >/dev/null 2>&1 || \
  aws ecr create-repository --region "$REGION" --repository-name "$REPO" >/dev/null

echo "==> Building image (arm64)..."
docker build -t "$REPO" "$PROJECT_DIR/scripts/dwg-converter-lambda"
docker tag "$REPO:latest" "$ECR/$REPO:latest"

echo "==> Pushing to ECR..."
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR" >/dev/null
docker push "$ECR/$REPO:latest" | tail -1

echo "==> IAM role $ROLE..."
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]
  }' >/dev/null
  aws iam attach-role-policy --role-name "$ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
fi

echo "==> Deploying Lambda $FUNC..."
if aws lambda get-function --function-name "$FUNC" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FUNC" --region "$REGION" \
    --image-uri "$ECR/$REPO:latest" >/dev/null
  aws lambda wait function-updated --function-name "$FUNC" --region "$REGION"
else
  for attempt in $(seq 1 10); do
    if aws lambda create-function --function-name "$FUNC" --region "$REGION" \
        --package-type Image --code "ImageUri=$ECR/$REPO:latest" \
        --architectures arm64 --timeout 60 --memory-size 1024 \
        --role "arn:aws:iam::${ACCOUNT}:role/${ROLE}" >/dev/null 2>&1; then
      break
    fi
    if [ "$attempt" = 10 ]; then echo "!! create-function failed"; exit 1; fi
    echo "    waiting for IAM role propagation ($attempt)..."
    sleep 3
  done
  aws lambda wait function-active --function-name "$FUNC" --region "$REGION"
fi

echo "==> Function URL + public invoke permission..."
URL="$(python3 - "$FUNC" "$REGION" <<'PYEOF'
import sys, boto3
fn, region = sys.argv[1], sys.argv[2]
lam = boto3.client('lambda', region_name=region)
cors = {'AllowOrigins': ['*'], 'AllowMethods': ['POST'], 'AllowHeaders': ['content-type'], 'MaxAge': 86400}
try:
    cfg = lam.create_function_url_config(FunctionName=fn, AuthType='NONE', Cors=cors)
except lam.exceptions.ResourceConflictException:
    cfg = lam.get_function_url_config(FunctionName=fn)
try:
    lam.add_permission(FunctionName=fn, StatementId='FunctionURLAllowPublicAccess',
                       Action='lambda:InvokeFunctionUrl', Principal='*', FunctionUrlAuthType='NONE')
except lam.exceptions.ResourceConflictException:
    pass
print(cfg['FunctionUrl'])
PYEOF
)"
echo ""
echo "==> Done. DWG converter endpoint:"
echo "    $URL"
echo ""
echo "    Bake into: main.ts DWG_CONVERT_URL, webpack.web.config.js __DWG_CONVERT_URL__"
