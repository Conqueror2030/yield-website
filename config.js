/**
 * ============================================================
 *  YIELD AI — GLOBAL ENVIRONMENT CONFIGURATION
 * ============================================================
 *
 *  This file is the SINGLE SOURCE OF TRUTH for all API endpoints.
 *  Production API origin: https://api.yieldai.space
 *
 * ============================================================
 */

window.YIELD_CONFIG = {
    ENV: 'production',
    API_BASE: 'https://api.yieldai.space',
    LEAD_FORM_ENDPOINT: 'https://api.yieldai.space/api/leads',
    WHATSAPP_CALLBACK_ENDPOINT: 'https://api.yieldai.space/api/whatsapp/callback',
    WHATSAPP_CONFIG_ENDPOINT: 'https://api.yieldai.space/api/whatsapp/config',
    WHATSAPP_AUTH_ENDPOINT: 'https://api.yieldai.space/api/whatsapp/auth',
    DASHBOARD_API: 'https://api.yieldai.space/api/dashboard',
    POCKETBASE_URL: 'https://api.yieldai.space'
};

console.log(
    '%c[Yield.ai Config]%c ENV=%s | API Origin\u2192%s',
    'color:#34D399;font-weight:bold',
    'color:#71717a',
    window.YIELD_CONFIG.ENV,
    window.YIELD_CONFIG.API_BASE
);
