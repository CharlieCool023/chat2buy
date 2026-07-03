# 🤖 WhatsApp Autopilot — AI Sales Assistant

> **Qwen Cloud Hackathon 2026** — Track 4: Autopilot Agent

An AI-powered WhatsApp sales assistant that lets small businesses (especially food vendors in Nigeria) automate customer interactions, negotiate prices within set rules, send product photos, and close orders with integrated payments — all through a single WhatsApp number using unique seller codes.

## ✨ What It Does

| Feature | Description |
|---------|-------------|
| **Multi-Seller Routing** | One WhatsApp number serves unlimited sellers. Customers enter a seller code to shop with their preferred vendor. |
| **AI-Powered Chat** | Built on Qwen 3.7 via Dashscope — handles natural conversation in English, Pidgin, or mixed language. |
| **Catalog Grounding** | The AI only ever quotes real items at real prices from the seller's catalog. No hallucinations. |
| **Smart Negotiation** | AI proposes discounts; deterministic rules engine approves or rejects based on seller policy. |
| **Owner Escalation** | Discount requests beyond policy limits are sent to the owner's WhatsApp for manual approval. |
| **Product Images** | Rich media support — product photos sent inline at natural conversation moments. |
| **Payment Integration** | Paystack-powered checkout — customers get secure payment links, sellers get instant order tickets. |
| **Seller Dashboard** | React-based dashboard for managing products, pricing rules, and viewing orders. |
| **Test Mode** | Sellers can test their bot as a customer before going live. |

## 🏗 Architecture

```
Customer WhatsApp → Meta Webhook → Express Server → Qwen AI (Dashscope)
                                                          ↓
                                                   Catalog + Policy
                                                          ↓
                                                  Discount Rules Engine
                                                          ↓
                                            WhatsApp Reply / Payment Link
                                                          ↓
                                            Owner Notification (WhatsApp)
                                                          ↓
                                            Seller Dashboard (React)
```

## 📁 Project Structure

```
whatsapp-autopilot/
├── server.js                  # Main Express app
├── package.json               # Dependencies
├── .env                       # Environment variables (not committed)
├── .env.example               # Template for env vars
├── data/
│   └── autopilot.json         # JSON database (local dev)
├── lib/
│   ├── db.js                  # Database layer (JSON/PostgreSQL)
│   ├── ai.js                  # Qwen/Dashscope integration + prompts
│   ├── whatsapp.js            # WhatsApp Cloud API helpers
│   ├── negotiation.js         # Discount rules engine
│   └── paystack.js            # Payment processing
├── routes/
│   ├── webhook.js             # WhatsApp webhook (core logic)
│   ├── dashboard-api.js       # REST API for dashboard
│   └── paystack-webhook.js    # Payment callback handler
├── dashboard-src/             # React dashboard source
│   ├── src/
│   │   ├── App.tsx            # Routing + auth
│   │   ├── components/
│   │   │   └── DashboardLayout.tsx
│   │   ├── pages/
│   │   │   ├── Overview.tsx
│   │   │   ├── Catalog.tsx
│   │   │   ├── Pricing.tsx
│   │   │   ├── Orders.tsx
│   │   │   └── Setup.tsx
│   │   └── hooks/
│   │       └── useApi.ts
│   └── dist/                  # Built dashboard (static files)
├── assets/
│   └── catalog/               # 8 generated product images
├── schema.sql                 # PostgreSQL schema (for Alibaba Cloud)
├── seed.js                    # Demo data seeder
└── seed.sql                   # PostgreSQL seed data
```

## 🚀 Local Setup

### Prerequisites
- Node.js 18+
- WhatsApp Cloud API test account (free at [developers.facebook.com](https://developers.facebook.com))
- Qwen Cloud API key (free at [home.qwencloud.com](https://home.qwencloud.com))
- Paystack test account (free at [paystack.com](https://paystack.com))

### 1. Clone & Install
```bash
cd whatsapp-autopilot
npm install --no-bin-links
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your credentials:
# - WHATSAPP_ACCESS_TOKEN (from Meta)
# - WHATSAPP_PHONE_NUMBER_ID (from Meta)
# - WHATSAPP_VERIFY_TOKEN (pick any string)
# - DASHSCOPE_API_KEY (from Qwen Cloud)
# - PAYSTACK_SECRET_KEY (from Paystack, test mode)
# - OWNER_WHATSAPP_NUMBER (your number)
```

### 3. Start the Server
```bash
npm start
# Server runs on http://localhost:3000
```

### 4. Expose Local Server (ngrok)
```bash
# Install ngrok: https://ngrok.com/download
ngrok http 3000
# Copy the HTTPS URL (e.g., https://abc123.ngrok-free.app)
```

### 5. Connect WhatsApp Webhook
1. Go to [Meta for Developers](https://developers.facebook.com) → Your App → WhatsApp → Configuration
2. Set Callback URL: `https://your-ngrok-url.ngrok-free.app/webhook`
3. Set Verify Token: `autopilot_verify_2026` (match your .env)
4. Click "Verify and Save"
5. Subscribe to `messages` webhook field

### 6. Test
1. Message your test WhatsApp number with: `MKN001` (demo seller code)
2. The AI will welcome you to "Mama Nkechi's Kitchen"
3. Browse the menu, negotiate, and place a test order!

### 7. Dashboard
Open `http://localhost:3000/dashboard` and login with token: `mkn001_token_hackathon2026`

## 📊 Demo Data

The project includes 8 Nigerian food products with AI-generated photos:
- Party Jollof Rice — ₦3,500
- Fried Rice Special — ₦3,500
- Small Chops Platter — ₦5,000
- Ofada Rice & Ayamase — ₦4,000
- Egusi Soup Combo — ₦4,500
- Chicken Suya Skewers — ₦3,000
- Chapman Punch (1L) — ₦2,000
- Sweet Puff-Puff (20 pcs) — ₦1,500

## 🔧 Key Engineering Decisions

1. **Single Number, Multi-Tenant**: One WhatsApp number routes to unlimited sellers via short codes. Avoids the complexity of Meta's Embedded Signup OAuth.
2. **JSON DB for Local Dev**: Zero-dependency file database for rapid local testing. Switch to PostgreSQL on Alibaba Cloud ApsaraDB for production.
3. **Deterministic Negotiation**: The AI *proposes* discounts, but a pure code function *decides* if they're allowed. No AI has unilateral pricing authority.
4. **Template-Generated Quotes**: Order recaps are built from structured data, never raw LLM text. Prevents price hallucinations.
5. **Warm, Natural Tone**: Few-shot examples in the system prompt make the bot feel like a friendly human, not a form.

## 🌍 Deploying to Alibaba Cloud

1. **Create ApsaraDB RDS** (PostgreSQL) and run `schema.sql`
2. **Create Function Compute** function with custom runtime
3. **Set environment variables** in FC console (same as .env)
4. **Create OSS bucket** for product images
5. **Generate permanent WhatsApp token** (System User token with no expiry)
6. **Update webhook URL** to your Alibaba Cloud HTTPS endpoint
7. Deploy using `s deploy` (Serverless Devs CLI)

## 📱 User Flow

### Customer Shopping
```
→ Customer texts your WhatsApp number
→ "Welcome! Enter a seller code or type SELL"
→ Customer enters "MKN001"
→ "Welcome to Mama Nkechi's Kitchen! Here's our menu..."
→ Customer browses, asks questions, sees product photos
→ Customer builds an order
→ "Can I get a discount?"
→ AI checks policy, auto-approves or escalates
→ Customer confirms, gets Paystack payment link
→ Owner gets order ticket on WhatsApp
```

### Seller Onboarding
```
→ Seller texts "SELL" to your WhatsApp number
→ AI interviews: business name, description, pricing flexibility
→ "Complete setup here: [dashboard link]"
→ Seller adds products, photos, pricing rules
→ Seller gets unique code to share with customers
→ "Type TEST to try your bot as a customer"
```

## 📄 License

MIT — see LICENSE file.

---

Built for the Qwen Cloud Hackathon 2026. Track 4: Autopilot Agent.
