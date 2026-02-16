#!/bin/bash
set -e

FUNCTION_NAME="marginarc-api"
REGION="us-east-1"
ROLE_ARN="arn:aws:iam::511683043714:role/bachelor-backend-role"

echo "Installing dependencies..."
npm ci --omit=dev

echo "Building admin portal..."
if [ -d "web" ] && [ -f "web/package.json" ]; then
  (cd web && npm ci && npx vite build)
fi

echo "Creating deployment package..."
rm -f lambda.zip
zip -r lambda.zip index.js package.json node_modules src public web/dist

echo "Deploying to Lambda..."
if aws lambda get-function --function-name $FUNCTION_NAME --region $REGION 2>/dev/null; then
  echo "Updating existing function..."
  aws lambda update-function-code \
    --function-name $FUNCTION_NAME \
    --zip-file fileb://lambda.zip \
    --region $REGION
else
  echo "Creating new function..."
  aws lambda create-function \
    --function-name $FUNCTION_NAME \
    --runtime nodejs18.x \
    --handler index.handler \
    --role $ROLE_ARN \
    --zip-file fileb://lambda.zip \
    --timeout 30 \
    --memory-size 512 \
    --region $REGION
fi

echo "Waiting for function to be ready..."
aws lambda wait function-updated --function-name $FUNCTION_NAME --region $REGION 2>/dev/null || true

echo "Checking for Function URL..."
if ! aws lambda get-function-url-config --function-name $FUNCTION_NAME --region $REGION 2>/dev/null; then
  echo "Creating Function URL..."
  aws lambda create-function-url-config \
    --function-name $FUNCTION_NAME \
    --auth-type NONE \
    --cors '{"AllowOrigins":["*"],"AllowMethods":["*"],"AllowHeaders":["*"]}' \
    --region $REGION

  echo "Adding public access permission..."
  aws lambda add-permission \
    --function-name $FUNCTION_NAME \
    --statement-id FunctionURLAllowPublicAccess \
    --action lambda:InvokeFunctionUrl \
    --principal "*" \
    --function-url-auth-type NONE \
    --region $REGION
fi

FUNCTION_URL=$(aws lambda get-function-url-config --function-name $FUNCTION_NAME --region $REGION --query 'FunctionUrl' --output text)
echo ""
echo "Deployment complete!"
echo "Function URL: $FUNCTION_URL"
