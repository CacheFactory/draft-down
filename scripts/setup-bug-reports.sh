#!/usr/bin/env bash
# Provision the DraftDown bug-report backend:
#   S3 bucket (private) + SES DKIM domain + IAM role + Lambda with Function URL.
# Idempotent — safe to re-run; re-deploys the Lambda code each time.
# Usage: ./scripts/setup-bug-reports.sh

set -euo pipefail

BUCKET="draftdown-bug-reports"
REGION="us-east-1"
FUNC="draftdown-bug-report"
ROLE="draftdown-bug-report-lambda"
EMAIL="${BUG_REPORT_EMAIL:?Set BUG_REPORT_EMAIL to the notification address}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LAMBDA_DIR="$PROJECT_DIR/scripts/bug-report-lambda"
ZIP="/tmp/draftdown-bug-report-fn.zip"

echo "==> S3 bucket (private)..."
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  # us-east-1: LocationConstraint must be omitted
  if ! aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"; then
    echo "!! Bucket name '$BUCKET' unavailable (global namespace)."
    echo "   Edit BUCKET in this script, e.g. ${BUCKET}-${ACCOUNT}, and re-run."
    exit 1
  fi
fi

# SES from the app's own domain, DKIM-verified via Route53 — fully automated,
# no confirmation clicks. NOT from the gmail address (Gmail spam-filters
# spoofed senders) and NOT SNS subscriptions (Gmail link scanners auto-click
# the unsubscribe link, deactivating the subscription after the first email).
DOMAIN="draftdownapp.com"
FROM="bugs@${DOMAIN}"
ZONE_ID="Z0520438LH9BL026VRN6"   # Route53 hosted zone for draftdownapp.com

echo "==> SES domain identity $DOMAIN (Easy DKIM via Route53)..."
TOKENS="$(aws sesv2 create-email-identity --region "$REGION" --email-identity "$DOMAIN" \
  --query 'DkimAttributes.Tokens' --output text 2>/dev/null || \
  aws sesv2 get-email-identity --region "$REGION" --email-identity "$DOMAIN" \
  --query 'DkimAttributes.Tokens' --output text)"
for t in $TOKENS; do
  aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch "{
    \"Changes\": [{\"Action\": \"UPSERT\", \"ResourceRecordSet\": {
      \"Name\": \"${t}._domainkey.${DOMAIN}\", \"Type\": \"CNAME\", \"TTL\": 300,
      \"ResourceRecords\": [{\"Value\": \"${t}.dkim.amazonses.com\"}]
    }}]
  }" >/dev/null
done
DKIM_STATUS="$(aws sesv2 get-email-identity --region "$REGION" --email-identity "$DOMAIN" \
  --query 'DkimAttributes.Status' --output text)"
echo "    DKIM status: $DKIM_STATUS (SUCCESS may take a few minutes after first run)"

echo "==> IAM role $ROLE..."
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]
  }' >/dev/null
fi
aws iam put-role-policy --role-name "$ROLE" --policy-name bug-report-access \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      {\"Effect\": \"Allow\", \"Action\": [\"s3:PutObject\", \"s3:GetObject\"], \"Resource\": \"arn:aws:s3:::${BUCKET}/*\"},
      {\"Effect\": \"Allow\", \"Action\": \"ses:SendEmail\", \"Resource\": \"arn:aws:ses:${REGION}:${ACCOUNT}:identity/${DOMAIN}\"},
      {\"Effect\": \"Allow\", \"Action\": [\"logs:CreateLogGroup\", \"logs:CreateLogStream\", \"logs:PutLogEvents\"], \"Resource\": \"*\"}
    ]
  }"

echo "==> Packaging Lambda..."
rm -f "$ZIP"
(cd "$LAMBDA_DIR" && zip -q -j "$ZIP" index.mjs)

echo "==> Deploying Lambda $FUNC..."
if aws lambda get-function --function-name "$FUNC" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FUNC" --region "$REGION" \
    --zip-file "fileb://$ZIP" >/dev/null
  aws lambda wait function-updated --function-name "$FUNC" --region "$REGION"
  aws lambda update-function-configuration --function-name "$FUNC" --region "$REGION" \
    --environment "Variables={BUCKET=$BUCKET,EMAIL=$EMAIL,FROM=$FROM}" >/dev/null
  aws lambda wait function-updated --function-name "$FUNC" --region "$REGION"
else
  # create-role → create-function races IAM propagation; retry
  for attempt in $(seq 1 10); do
    if aws lambda create-function --function-name "$FUNC" --region "$REGION" \
        --runtime nodejs20.x --handler index.handler \
        --timeout 30 --memory-size 512 \
        --environment "Variables={BUCKET=$BUCKET,EMAIL=$EMAIL,FROM=$FROM}" \
        --role "arn:aws:iam::${ACCOUNT}:role/${ROLE}" \
        --zip-file "fileb://$ZIP" >/dev/null 2>&1; then
      break
    fi
    if [ "$attempt" = 10 ]; then
      echo "!! create-function failed after 10 attempts"; exit 1
    fi
    echo "    waiting for IAM role propagation ($attempt)..."
    sleep 3
  done
  aws lambda wait function-active --function-name "$FUNC" --region "$REGION"
fi

echo "==> Function URL + public invoke permission..."
if aws lambda create-function-url-config help >/dev/null 2>&1; then
  aws lambda create-function-url-config --function-name "$FUNC" --region "$REGION" \
    --auth-type NONE \
    --cors '{"AllowOrigins":["*"],"AllowMethods":["POST"],"AllowHeaders":["content-type"],"MaxAge":86400}' \
    >/dev/null 2>&1 || true
  aws lambda add-permission --function-name "$FUNC" --region "$REGION" \
    --statement-id FunctionURLAllowPublicAccess --action lambda:InvokeFunctionUrl \
    --principal '*' --function-url-auth-type NONE >/dev/null 2>&1 || true
  URL="$(aws lambda get-function-url-config --function-name "$FUNC" --region "$REGION" \
    --query FunctionUrl --output text)"
else
  # AWS CLI predates Function URLs (needs >= 2.5); fall back to boto3
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
fi
echo ""
echo "==> Done. Bug-report endpoint:"
echo "    $URL"
echo ""
echo "    Ensure this URL is baked into:"
echo "      - webpack.web.config.js + webpack.renderer.config.js (__BUG_REPORT_URL__)"
echo "      - src/renderer/index.html CSP connect-src (host only)"
