# Azure VM demo deployment

This is the fastest reliable Azure deployment for the presentation. It runs the same Docker Compose stack you run locally on one Azure VM.

## What gets deployed

- frontend
- gateway
- auth
- order
- inventory
- notification
- payments
- fraud
- shipping
- recommendation
- healer
- nats
- etcd
- otel-collector
- jaeger
- prometheus

## Why VM instead of Container Apps for the demo

Azure Container Apps is a good long-term fit, but this project already works with Docker Compose and Docker service names like `auth:50051`, `nats:4222`, and `etcd:2379`. A VM preserves that exactly and avoids late-stage gRPC/TCP ingress surprises.

## Login

```bash
az login
az account list --output table
az account set --subscription "<your Azure for Students subscription name or id>"
```

## Deploy

From the project root:

```bash
./deploy/azure-vm/create-and-deploy.sh
```

Optional overrides:

```bash
AZURE_LOCATION=westus2 \
AZURE_RESOURCE_GROUP=mesh-demo-rg \
AZURE_VM_NAME=mesh-demo-vm \
AZURE_VM_SIZE=Standard_B2s \
./deploy/azure-vm/create-and-deploy.sh
```

`Standard_B2s` is the smallest recommended size for the full demo stack. `Standard_B1ms` is cheaper, but it is likely to run out of memory while building/running all containers.

## URLs

The deploy script prints:

```text
Frontend:   http://<public-ip>:8080
Gateway:    http://<public-ip>:8081
Healer API: http://<public-ip>:8090
Jaeger:     http://<public-ip>:16686
Prometheus: http://<public-ip>:9090
```

## Google OAuth

Use the values printed by the deploy script in Google Cloud Console.

Authorized JavaScript origin:

```text
http://<public-ip>:8080
```

Authorized redirect URI:

```text
http://<public-ip>:8080/auth/google/callback
```

## Stop everything

```bash
./deploy/azure-vm/stop.sh
```

This deallocates the VM and stops compute billing. Storage and public IP resources can still have small charges.

## Start again

```bash
./deploy/azure-vm/start.sh
```

## Delete everything

```bash
./deploy/azure-vm/delete.sh
```
