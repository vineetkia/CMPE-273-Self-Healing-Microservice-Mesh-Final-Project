# Vercel + Render + GCP deployment notes

Use this split for the demo:

- Vercel: frontend
- Render: app services and gateway
- GCP Compute Engine VM: NATS and etcd

## CLI reality

There is no required `render login` flow for this project. Render is easiest through the dashboard with a connected GitHub repository or a Blueprint.

If `gcloud` is not installed locally, use Google Cloud Shell in the browser. It already has `gcloud`.

Vercel can be deployed with the CLI:

```bash
npx vercel login
npx vercel --cwd frontend
npx vercel --cwd frontend --prod
```

## Frontend env on Vercel

Set these in the Vercel project:

```bash
VITE_GATEWAY_URL=https://<gateway-service>.onrender.com
VITE_HEALER_URL=https://<healer-service>.onrender.com
VITE_FRONTEND_URL=https://<frontend-project>.vercel.app
VITE_JAEGER_URL=
VITE_PROM_URL=
```

## Google OAuth production callback

After Vercel and Render URLs are known, update Google Cloud OAuth:

Authorized JavaScript origins:

```text
https://<frontend-project>.vercel.app
```

Authorized redirect URIs:

```text
https://<gateway-service>.onrender.com/auth/google/callback
```

Set these on the Render gateway:

```bash
FRONTEND_URL=https://<frontend-project>.vercel.app
GOOGLE_OAUTH_REDIRECT_URI=https://<gateway-service>.onrender.com/auth/google/callback
GOOGLE_OAUTH_ALLOWED_ORIGINS=https://<frontend-project>.vercel.app
GOOGLE_OAUTH_CLIENT_ID=<client-id>
GOOGLE_OAUTH_CLIENT_SECRET=<client-secret>
GOOGLE_OAUTH_STATE_SECRET=<random-secret>
```

## Backend env on Render

All backend services need:

```bash
ETCD_HOST=<gcp-vm-external-ip>
ETCD_PORT=2379
NATS_URL=nats://mesh:<nats-password>@<gcp-vm-external-ip>:4222
OTEL_EXPORTER_OTLP_ENDPOINT=
```

Use `deploy/gcp-infra/README.md` to create the VM and get the values.

## Important Render caveat

The current microservices talk to each other with gRPC. Render public web services are HTTP-facing and free services can sleep. For the safest one-day demo, deploy the GCP infra first, then test Render service-to-service gRPC before relying on it live. If that becomes flaky, the reliable fallback is to run the backend stack on one VM and keep only the frontend on Vercel.
