# Alibaba Cloud Deployment Proof

This project is designed to run on Alibaba Cloud as one containerized service:

- Alibaba Cloud Model Studio / DashScope hosts the Qwen model used by `whatsapp-autopilot/lib/ai.js`.
- The Express backend runs as a public HTTPS service on Alibaba Cloud Serverless App Engine, Elastic Compute Service, or Function Compute custom container.
- Alibaba Cloud Container Registry can build and store the root `Dockerfile` image.
- Optional production data can use ApsaraDB RDS for PostgreSQL; local development uses `whatsapp-autopilot/data/autopilot.json`.

## Required environment variables

Set these on the Alibaba runtime:

```bash
NODE_ENV=production
PORT=3000
DASHSCOPE_API_KEY=your_model_studio_key
AI_MODEL=qwen3-235b-a22b-instruct-2507
AI_ENABLE_THINKING=false
WHATSAPP_ACCESS_TOKEN=your_meta_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_VERIFY_TOKEN=your_verify_token
GRAPH_API_VERSION=v21.0
PAYSTACK_SECRET_KEY=your_paystack_test_or_live_key
PAYSTACK_CALLBACK_URL=https://your-alibaba-domain/webhook/paystack
APP_PUBLIC_URL=https://your-alibaba-domain
NGROK_URL=https://your-alibaba-domain
DASHBOARD_URL=https://your-alibaba-domain/dashboard
WHATSAPP_DRY_RUN=false
ENABLE_DEV_SIMULATOR=false
```

## Build and run the same image locally

```bash
docker build -t chat2buy-autopilot .
docker run --env-file whatsapp-autopilot/.env -p 3000:3000 chat2buy-autopilot
```

## Meta webhook URL

After Alibaba gives you the HTTPS service URL, set the Meta WhatsApp callback URL to:

```text
https://your-alibaba-domain/webhook
```

Use the same `WHATSAPP_VERIFY_TOKEN` value from the Alibaba environment.

## Submission proof file

For Devpost's "Proof of Alibaba Cloud Deployment" requirement, link judges to:

- `whatsapp-autopilot/lib/ai.js` for Qwen Cloud / DashScope API usage.
- `Dockerfile` for the Alibaba-ready container build.
- this `deploy/alibaba/README.md` for Alibaba deployment instructions.
