#!/bin/bash

# Sora2 Test Page Quick Launcher
# 快速启动 Sora2 测试页面

PORT=${1:-5173}
TEST_URL="http://localhost:$PORT/?sora2-test=true"

echo "🚀 Sora2 Test Page Launcher"
echo "================================"
echo ""
echo "Opening Sora2 test page..."
echo "URL: $TEST_URL"
echo ""

# Try to open with different browsers/commands depending on OS
if command -v open &> /dev/null; then
    # macOS
    open "$TEST_URL"
elif command -v xdg-open &> /dev/null; then
    # Linux
    xdg-open "$TEST_URL"
elif command -v start &> /dev/null; then
    # Windows
    start "$TEST_URL"
else
    echo "Please open the following URL in your browser:"
    echo "$TEST_URL"
fi

echo ""
echo "✅ Ready to test Sora2 API!"
echo ""
echo "Steps:"
echo "1. Copy your API key: sk-ERFNrFQLBnJNbLxaIVixcLzyc3bpIeIdbzWrYMJFm42djtXr"
echo "2. Paste it in the API Key field"
echo "3. Enter your video prompt"
echo "4. Click 'Generate Video' button"
echo ""
echo "📖 For more details, see SORA2_TEST_GUIDE.md"
