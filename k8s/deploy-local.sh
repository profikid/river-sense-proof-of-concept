#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
K8S_DIR="${ROOT_DIR}/k8s"
NAMESPACE="${NAMESPACE:-vectorflow}"

API_IMAGE="${API_IMAGE:-vectorflow-api:local}"
WORKER_IMAGE="${WORKER_IMAGE:-vectorflow-worker:local}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-vectorflow-frontend:local}"

VITE_API_URL="${VITE_API_URL:-http://localhost:8000}"
VITE_GRAFANA_DASHBOARD_URL="${VITE_GRAFANA_DASHBOARD_URL:-http://localhost:3000/d/vector-flow/vector-flow-overview}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd docker
require_cmd kubectl

if [[ "${NAMESPACE}" != "vectorflow" ]]; then
  echo "NAMESPACE override is not supported by the static manifests. Use NAMESPACE=vectorflow." >&2
  exit 1
fi

echo "[1/6] Building local images"
docker build -t "${API_IMAGE}" "${ROOT_DIR}/backend"
docker build -t "${WORKER_IMAGE}" "${ROOT_DIR}/worker"
docker build \
  -t "${FRONTEND_IMAGE}" \
  --build-arg "VITE_API_URL=${VITE_API_URL}" \
  --build-arg "VITE_GRAFANA_DASHBOARD_URL=${VITE_GRAFANA_DASHBOARD_URL}" \
  "${ROOT_DIR}/frontend"

context="$(kubectl config current-context 2>/dev/null || true)"
if [[ "${context}" == kind-* ]]; then
  if command -v kind >/dev/null 2>&1; then
    cluster_name="${context#kind-}"
    echo "[2/6] Loading images into kind cluster ${cluster_name}"
    kind load docker-image --name "${cluster_name}" "${API_IMAGE}" "${WORKER_IMAGE}" "${FRONTEND_IMAGE}"
  else
    echo "[2/6] kind context detected but 'kind' CLI not found; skipping image load"
  fi
elif [[ "${context}" == minikube* ]]; then
  if command -v minikube >/dev/null 2>&1; then
    echo "[2/6] Loading images into minikube"
    minikube image load "${API_IMAGE}"
    minikube image load "${WORKER_IMAGE}"
    minikube image load "${FRONTEND_IMAGE}"
  else
    echo "[2/6] minikube context detected but 'minikube' CLI not found; skipping image load"
  fi
else
  echo "[2/6] Context '${context:-unknown}' detected; assuming images are pullable by the cluster"
fi

echo "[3/6] Ensuring namespace + configmaps"
kubectl apply -f "${K8S_DIR}/namespace.yaml"

kubectl -n "${NAMESPACE}" create configmap vectorflow-init-sql \
  --from-file=init.sql="${ROOT_DIR}/init.sql" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "${NAMESPACE}" create configmap vectorflow-prometheus-config \
  --from-file=prometheus.yml="${K8S_DIR}/prometheus-config.yml" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "${NAMESPACE}" create configmap vectorflow-grafana-provisioning \
  --from-file=datasource.yml="${ROOT_DIR}/grafana/provisioning/datasources/datasource.yml" \
  --from-file=dashboard.yml="${ROOT_DIR}/grafana/provisioning/dashboards/dashboard.yml" \
  --from-file=alert_rules.yml="${ROOT_DIR}/grafana/provisioning/alerting/alert_rules.yml" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "${NAMESPACE}" create configmap vectorflow-grafana-dashboard \
  --from-file=vector-flow.json="${ROOT_DIR}/grafana/dashboards/vector-flow.json" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "[4/6] Applying Kubernetes manifests"
kubectl apply -f "${K8S_DIR}/secret.yaml"
kubectl apply -f "${K8S_DIR}/rbac-api.yaml"
kubectl apply -f "${K8S_DIR}/rbac-prometheus.yaml"
kubectl apply -f "${K8S_DIR}/postgres.yaml"
kubectl apply -f "${K8S_DIR}/redis.yaml"
kubectl apply -f "${K8S_DIR}/api.yaml"
kubectl apply -f "${K8S_DIR}/prometheus.yaml"
kubectl apply -f "${K8S_DIR}/grafana.yaml"
kubectl apply -f "${K8S_DIR}/frontend.yaml"

echo "[5/6] Applying image overrides"
kubectl -n "${NAMESPACE}" set image deployment/vectorflow-api api="${API_IMAGE}"
kubectl -n "${NAMESPACE}" set image deployment/vectorflow-frontend frontend="${FRONTEND_IMAGE}"
kubectl -n "${NAMESPACE}" set env deployment/vectorflow-api WORKER_IMAGE="${WORKER_IMAGE}"
kubectl -n "${NAMESPACE}" rollout restart deployment/vectorflow-api
kubectl -n "${NAMESPACE}" rollout restart deployment/vectorflow-frontend

echo "[6/6] Waiting for rollout"
kubectl -n "${NAMESPACE}" rollout status deployment/vectorflow-db --timeout=240s
kubectl -n "${NAMESPACE}" rollout status deployment/vectorflow-redis --timeout=240s
kubectl -n "${NAMESPACE}" rollout status deployment/vectorflow-api --timeout=240s
kubectl -n "${NAMESPACE}" rollout status deployment/vectorflow-prometheus --timeout=240s
kubectl -n "${NAMESPACE}" rollout status deployment/vectorflow-grafana --timeout=240s
kubectl -n "${NAMESPACE}" rollout status deployment/vectorflow-frontend --timeout=240s

cat <<MSG
Deployment completed.

Access locally via port-forward (run each in a separate terminal):
  kubectl -n ${NAMESPACE} port-forward svc/frontend 5173:80
  kubectl -n ${NAMESPACE} port-forward svc/api 8000:8000
  kubectl -n ${NAMESPACE} port-forward svc/grafana 3000:3000
  kubectl -n ${NAMESPACE} port-forward svc/prometheus 9090:9090
MSG
