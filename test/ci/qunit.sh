#!/bin/bash
# CI helper (sealed build): serve the repo with PHP (the ajax tests hit
# test/data/*.php) and run the QUnit suite in headless Chrome.
set -e
ROOT="$(pwd)"
PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:8000 -t "$ROOT" > /tmp/php-server.log 2>&1 &
sleep 2

# puppeteer needs a modern Node; the build itself stays on the project's Node 0.10
source "$HOME/.nvm/nvm.sh"
nvm install 18
mkdir -p /tmp/qunit-runner
( cd /tmp/qunit-runner && echo '{"name":"qunit-runner","private":true}' > package.json && \
  PUPPETEER_SKIP_DOWNLOAD=1 npm install --no-audit --no-fund --loglevel=http \
    --registry=https://registry.npmjs.org/ puppeteer-core@21.11.0 )
CHROME_BIN="${CHROME_BIN:-$(command -v google-chrome-stable || command -v google-chrome)}"
export CHROME_BIN
"$CHROME_BIN" --version

echo "==== Tests excluded at source level (SEALED-SKIP markers) ===="
grep -rn "SEALED-SKIP" test/unit || echo "(none)"

NODE_PATH=/tmp/qunit-runner/node_modules node test/ci/run-qunit.js \
	"http://127.0.0.1:8000/test/index.html${QUNIT_QUERY:-}"
