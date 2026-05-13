# Azure Container Apps deployment

This deploys the demo mesh to Azure Container Apps:

- Public: `frontend`, `gateway`, `healer`, `jaeger`, `prometheus`
- Internal: `auth`, `order`, `inventory`, `notification`, `payments`, `fraud`, `shipping`, `recommendation`, `nats`, `etcd`, `otelcollector`

The deployment exposes internal metrics ports for Prometheus and an internal OTLP port for the collector/Jaeger path.

## Deploy

```bash
az login
az account set --subscription "<subscription id or name>"
./deploy/azure-container-apps/deploy.sh
```

Optional smaller-region override:

```bash
AZURE_LOCATION=eastus ./deploy/azure-container-apps/deploy.sh
```

Optional Google sign-in env vars:

```bash
export GOOGLE_OAUTH_CLIENT_ID="..."
export GOOGLE_OAUTH_CLIENT_SECRET="..."
export GOOGLE_OAUTH_STATE_SECRET="$(openssl rand -hex 32)"
./deploy/azure-container-apps/deploy.sh
```

After deploy, add the printed frontend URL as the Google OAuth Authorized JavaScript origin and the printed gateway callback URL as the Authorized redirect URI.

Optional Groq healer env vars:

```bash
export GROQ_API_KEY="..."
export GROQ_CHAT_MODEL="llama-3.3-70b-versatile"
./deploy/azure-container-apps/deploy.sh
```

The deploy script maps Groq onto the healer's OpenAI-compatible settings using `https://api.groq.com/openai/v1` and stores the key as a Container Apps secret.

## Stop everything

```bash
./deploy/azure-container-apps/stop.sh
```

## Start again

```bash
./deploy/azure-container-apps/start.sh
```

## Delete all Azure resources

```bash
./deploy/azure-container-apps/delete.sh
```
