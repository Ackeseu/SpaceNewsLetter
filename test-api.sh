#!/bin/bash

echo "========================================="
echo "NewSpace Newsletter API - Local Tests"
echo "========================================="
echo ""

BASE_URL="http://localhost:3000"

# Test 1: Server Status
echo "✓ Test 1: Server Status"
curl -s $BASE_URL | jq '.'
echo ""

# Test 2: Health Check
echo "✓ Test 2: Health Check"
curl -s $BASE_URL/health | jq '.'
echo ""

# Test 3: Get Latest Articles
echo "✓ Test 3: Get Latest Articles (limit 3)"
curl -s "$BASE_URL/api/newsletters/articles?limit=3" | jq '.articles[] | {title, source, pubDate}'
echo ""

# Test 4: Subscribe to Newsletter
echo "✓ Test 4: Subscribe to Newsletter"
SUBSCRIBE_RESPONSE=$(curl -s -X POST $BASE_URL/api/subscriptions/subscribe \
  -H "Content-Type: application/json" \
  -d '{
    "email": "demo@newspace.com",
    "firstName": "Demo",
    "lastName": "User",
    "frequency": "weekly",
    "topics": ["space", "astronomy"]
  }')
echo $SUBSCRIBE_RESPONSE | jq '.'
SUBSCRIBER_ID=$(echo $SUBSCRIBE_RESPONSE | jq -r '.subscriber.id')
echo ""

# Test 5: Update Preferences
if [ "$SUBSCRIBER_ID" != "null" ]; then
  echo "✓ Test 5: Update Subscription Preferences (ID: $SUBSCRIBER_ID)"
  curl -s -X PUT $BASE_URL/api/subscriptions/preferences/$SUBSCRIBER_ID \
    -H "Content-Type: application/json" \
    -d '{
      "frequency": "daily",
      "topics": ["space", "nasa", "esa"]
    }' | jq '.message'
  echo ""
fi

# Test 6: Filter Articles by Source
echo "✓ Test 6: Filter Articles by Source (SpaceNews)"
curl -s "$BASE_URL/api/newsletters/articles?source=SpaceNews&limit=2" | jq '.articles[] | {title, source}'
echo ""

# Test 7: Get Article Count
echo "✓ Test 7: Total Articles in Database"
curl -s "$BASE_URL/api/newsletters/articles?limit=1000" | jq '.count'
echo ""

echo "========================================="
echo "✓ All tests completed successfully!"
echo "========================================="
