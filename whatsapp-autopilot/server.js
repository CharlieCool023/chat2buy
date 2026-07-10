import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

if (process.env.ALLOW_SELF_SIGNED_CERTS === 'true') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    console.warn('[Server] Self-signed certificate checking disabled for development.');
}

import webhookRoutes from './routes/webhook.js';
import dashboardApiRoutes from './routes/dashboard-api.js';
import paystackWebhookRoutes from './routes/paystack-webhook.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV,
        version: '1.0.0'
    });
});

// API routes
app.use(webhookRoutes);
app.use('/api', dashboardApiRoutes);
app.use(paystackWebhookRoutes);

// Serve dashboard (static files from dashboard-dist)
const dashboardPath = path.join(__dirname, 'dashboard-dist');
app.use('/dashboard', express.static(dashboardPath));
app.get('/dashboard*', (req, res) => {
    res.sendFile(path.join(dashboardPath, 'index.html'));
});

// Root redirect
app.get('/', (req, res) => {
    res.json({
        name: 'WhatsApp Autopilot API',
        version: '1.0.0',
        endpoints: {
            webhook: '/webhook',
            dashboard_api: '/api/dashboard/*',
            paystack_webhook: '/webhook/paystack',
            health: '/health'
        }
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found', path: req.path });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('[Server] Error:', err);
    res.status(500).json({
        error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
});

app.listen(PORT, () => {
    console.log(`
WhatsApp Autopilot - Qwen Cloud Hackathon
Server running on port ${PORT}
Environment: ${process.env.NODE_ENV || 'development'}
Webhook:   POST /webhook
Simulator: POST /dev/simulate
Dashboard: /dashboard
Health:    GET /health
`);
});
export default app;
