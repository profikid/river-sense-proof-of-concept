#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-vectorflow}"

kubectl delete namespace "${NAMESPACE}"
