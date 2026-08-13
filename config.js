/**
 * ============================================================
 *  YIELD AI — GLOBAL ENVIRONMENT CONFIGURATION
 * ============================================================
 *
 *  This file is the SINGLE SOURCE OF TRUTH for all API endpoints.
 *  Edit only this file to swap between local dev and production.
 *
 *  Load order (both pages):
 *    <script src="/config.js"></script>   ← this file
 *    then the inline page <script>         ← reads window.YIELD_CONFIG
 *
 *  NOTE: When opening pages as raw file:// URLs (no server),
 *  this script will 404. That is fine — every page has inline
 *  fallback constants so everything still works without a server.
 *  This file activates as soon as you serve the folder:
 *    npx serve .          (Node)
 *    python -m http.server (Python)
 *
 * ============================================================
 */

window.YIELD_CONFIG = {

    /**
     * Environment label — shown in browser console on page load.
     *   'local'       for local dev / ngrok tunnels
     *   'production'  for live yieldai.space deployment
     */
    ENV: 'production',

    // --------------------------------------------------------
    // LEAD CAPTURE FORM  (main index.html #book-demo section)
    // --------------------------------------------------------
    // local dev  : 'http://localhost:3000/api/leads'
    // live cloud : 'http://34.24.209.173:3000/api/leads'   (Node backend on GCP VPS)
    // fallback   : Formspree (no server needed, always works)
    LEAD_FORM_ENDPOINT: 'http://34.24.209.173:3000/api/leads',
    // LEAD_FORM_ENDPOINT: 'http://localhost:3000/api/leads',       // ← local dev
    // LEAD_FORM_ENDPOINT: 'https://formspree.io/f/xoeajron',       // ← fallback

    // --------------------------------------------------------
    // WHATSAPP EMBEDDED SIGNUP  (connect/index.html)
    // --------------------------------------------------------
    // After Meta authorization completes, the token payload is
    // POSTed to this URL.
    //
    // local dev  : your ngrok tunnel — e.g. 'https://xxxx.ngrok-free.app/api/whatsapp/callback'
    //              OR paste the ngrok URL into the "Backend API Config" panel on the page.
    // live cloud : 'http://34.24.209.173:3000/api/whatsapp/callback'   (Node backend on GCP VPS)
    // empty      : '' means the connect page will prompt via the in-page dev panel
    WHATSAPP_CALLBACK_ENDPOINT: 'http://34.24.209.173:3000/api/whatsapp/callback',
    // WHATSAPP_CALLBACK_ENDPOINT: 'http://localhost:3000/api/whatsapp/callback',   // ← local dev

};

// ---- Dev console banner ----------------------------------------
console.log(
    '%c[Yield.ai Config]%c ENV=%s | Lead→%s | WA Callback→%s',
    'color:#34D399;font-weight:bold',
    'color:#71717a',
    window.YIELD_CONFIG.ENV,
    window.YIELD_CONFIG.LEAD_FORM_ENDPOINT || '(not set)',
    window.YIELD_CONFIG.WHATSAPP_CALLBACK_ENDPOINT || '(not set — use in-page panel)'
);
