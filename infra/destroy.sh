#!/usr/bin/env bash
# Tears everything down so AWS stops billing. Run after you finish recording the demo.
set -euo pipefail
cd "$(dirname "$0")/terraform"
terraform destroy -input=false -auto-approve
