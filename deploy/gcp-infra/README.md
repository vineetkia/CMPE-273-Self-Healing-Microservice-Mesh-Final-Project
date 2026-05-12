# GCP demo infra for NATS and etcd

This runs the non-HTTP infrastructure services on one Google Compute Engine VM:

- NATS on `4222`
- NATS monitor on `8222`
- etcd on `2379`

Use this from Google Cloud Shell if `gcloud` is not installed locally.

## 1. Create the VM

Open Google Cloud Shell in the browser and run:

```bash
PROJECT_ID="your-gcp-project-id"
ZONE="us-central1-a"
VM_NAME="mesh-demo-infra"

gcloud config set project "$PROJECT_ID"

gcloud compute instances create "$VM_NAME" \
  --zone "$ZONE" \
  --machine-type e2-micro \
  --image-family debian-12 \
  --image-project debian-cloud \
  --boot-disk-size 20GB \
  --tags mesh-demo-infra

gcloud compute firewall-rules create mesh-demo-infra-ports \
  --allow tcp:2379,tcp:4222,tcp:8222 \
  --target-tags mesh-demo-infra \
  --source-ranges 0.0.0.0/0
```

This opens demo ports publicly. Close the rule after the presentation.

## 2. Copy and run the setup script

From the project root in Cloud Shell:

```bash
gcloud compute scp deploy/gcp-infra/docker-compose.yml deploy/gcp-infra/setup-vm.sh \
  mesh-demo-infra:/tmp/ \
  --zone us-central1-a

gcloud compute ssh mesh-demo-infra \
  --zone us-central1-a \
  --command "cd /tmp && chmod +x setup-vm.sh && ./setup-vm.sh"
```

Get the VM external IP:

```bash
gcloud compute instances describe mesh-demo-infra \
  --zone us-central1-a \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
```

## 3. Render environment variables

Set these on every Render backend service:

```bash
ETCD_HOST=<VM_EXTERNAL_IP>
ETCD_PORT=2379
NATS_URL=nats://mesh:<PASSWORD_FROM_SETUP_OUTPUT>@<VM_EXTERNAL_IP>:4222
```

## 4. Stop and start

Stop the VM after the demo:

```bash
gcloud compute instances stop mesh-demo-infra --zone us-central1-a
```

Start it again:

```bash
gcloud compute instances start mesh-demo-infra --zone us-central1-a
```

Delete the public firewall rule after the demo if you no longer need it:

```bash
gcloud compute firewall-rules delete mesh-demo-infra-ports
```
