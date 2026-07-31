#!/usr/bin/env bash
# @archigraph web.platform
# Deploy DraftDown Web to S3 + CloudFront
# Usage: ./scripts/deploy-web.sh

set -euo pipefail

BUCKET="draftdown-web-prod"
REGION="us-east-1"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$PROJECT_DIR/dist/web"

echo "==> Building web version..."
cd "$PROJECT_DIR"
export SKP_CONVERT_URL="https://hzmbrm9pw6.us-east-1.awsapprunner.com"
export BUG_REPORT_URL="https://4ghrpkzeex7bnuacgrrzzco4oe0xvtdo.lambda-url.us-east-1.on.aws/"
npm run build:web

echo "==> Checking S3 bucket..."
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "    Creating bucket $BUCKET..."
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"

  echo "    Disabling block public access..."
  aws s3api put-public-access-block --bucket "$BUCKET" \
    --public-access-block-configuration \
    "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

  echo "    Setting bucket policy for public read..."
  aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Sid\": \"PublicReadGetObject\",
      \"Effect\": \"Allow\",
      \"Principal\": \"*\",
      \"Action\": \"s3:GetObject\",
      \"Resource\": \"arn:aws:s3:::${BUCKET}/*\"
    }]
  }"

  echo "    Enabling static website hosting..."
  aws s3 website "s3://$BUCKET" --index-document index.html --error-document index.html
fi

echo "==> Syncing files to S3..."
# Upload JS with long cache (contenthash in filename)
aws s3 sync "$DIST_DIR" "s3://$BUCKET" \
  --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "index.html" \
  --exclude "*.map"

# Upload index.html with no-cache (always fetch latest)
aws s3 cp "$DIST_DIR/index.html" "s3://$BUCKET/index.html" \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/html"

echo "==> Checking CloudFront distribution..."
DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Origins.Items[0].DomainName=='${BUCKET}.s3.${REGION}.amazonaws.com'].Id | [0]" \
  --output text 2>/dev/null)

if [ "$DIST_ID" = "None" ] || [ -z "$DIST_ID" ]; then
  echo "    Creating CloudFront distribution..."
  DIST_ID=$(aws cloudfront create-distribution \
    --query 'Distribution.Id' \
    --output text \
    --distribution-config "{
      \"CallerReference\": \"draftdown-web-$(date +%s)\",
      \"Comment\": \"DraftDown Web App\",
      \"Enabled\": true,
      \"DefaultRootObject\": \"index.html\",
      \"Origins\": {
        \"Quantity\": 1,
        \"Items\": [{
          \"Id\": \"S3-${BUCKET}\",
          \"DomainName\": \"${BUCKET}.s3.${REGION}.amazonaws.com\",
          \"S3OriginConfig\": { \"OriginAccessIdentity\": \"\" }
        }]
      },
      \"DefaultCacheBehavior\": {
        \"TargetOriginId\": \"S3-${BUCKET}\",
        \"ViewerProtocolPolicy\": \"redirect-to-https\",
        \"AllowedMethods\": {
          \"Quantity\": 2,
          \"Items\": [\"GET\", \"HEAD\"],
          \"CachedMethods\": { \"Quantity\": 2, \"Items\": [\"GET\", \"HEAD\"] }
        },
        \"ForwardedValues\": {
          \"QueryString\": false,
          \"Cookies\": { \"Forward\": \"none\" }
        },
        \"MinTTL\": 0,
        \"DefaultTTL\": 86400,
        \"MaxTTL\": 31536000,
        \"Compress\": true
      },
      \"CustomErrorResponses\": {
        \"Quantity\": 1,
        \"Items\": [{
          \"ErrorCode\": 404,
          \"ResponsePagePath\": \"/index.html\",
          \"ResponseCode\": \"200\",
          \"ErrorCachingMinTTL\": 0
        }]
      },
      \"PriceClass\": \"PriceClass_100\",
      \"ViewerCertificate\": { \"CloudFrontDefaultCertificate\": true }
    }")
  echo "    Created distribution: $DIST_ID"
else
  echo "    Found existing distribution: $DIST_ID"
fi

echo "==> Invalidating CloudFront cache..."
aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" \
  --paths "/index.html" "/*" \
  --query 'Invalidation.Id' \
  --output text

# Get the CloudFront domain
CF_DOMAIN=$(aws cloudfront get-distribution \
  --id "$DIST_ID" \
  --query 'Distribution.DomainName' \
  --output text)

echo ""
echo "==> Deploy complete!"
echo "    https://draftdownapp.com"
echo ""
echo "    CloudFront: https://${CF_DOMAIN}"
echo "    S3:         s3://${BUCKET}"
