import crypto from "node:crypto";

const CONFIG = {
  cloudRunUrl: "https://hatikvah-care-882987938160.asia-south1.run.app",
  adminEmail: "admin@hatikvah.care",
  adminPassword: "CareSecure2026!",
  rzpKeyId: "rzp_live_TuMnDul7pZfH1r",
  rzpSecret: "v5rEdpBDgGNqeWu2S0fHLQDR",
  rzpWebhookSecret: "hatikvah_care_rzp_hook_2026",
  sfxToken: "9da6cf290af179442cc9c8b8b3ca690a40c9f280",
  sfxBaseUrl: "https://dale.shadowfax.in",
  pickupPincode: "500034",
  waPhoneId: "1368252233043036",
  waWabaId: "2667221577035024",
  waToken: "EAAPiD14MJJYBS76Hn5n92UHgeYVm2y5XzkRn322pA1fOJvTi5ZBegS0p51ZChLZAJFk4eS9gTiXG7RTDIC7FbAyvGMjfpGIZBnmeMAZBwuzH6WmhhBD2v1oWJnudPQoZAoDe0lZApxXlRiPl05htsiN6K9zBEZAAu8VaEwSGXDjemm2WQ5ate2F4vWOXGZCBb0gZDZD"
};

async function testRazorpay() {
  console.log("\n--- [1] TESTING RAZORPAY LIVE INTEGRATION ---");
  const authHeader = "Basic " + Buffer.from(`${CONFIG.rzpKeyId}:${CONFIG.rzpSecret}`).toString("base64");
  
  // 1. Fetch payments list to verify credentials
  try {
    const res = await fetch("https://api.razorpay.com/v1/payments?count=1", {
      headers: { Authorization: authHeader }
    });
    const data = await res.json();
    if (res.ok) {
      console.log("✅ Razorpay API Auth: SUCCESS (Key & Secret Valid)");
      console.log(`   Account Payments Count: ${data.count ?? data.items?.length ?? 0}`);
    } else {
      console.error("❌ Razorpay API Auth FAILED:", data);
    }
  } catch (err) {
    console.error("❌ Razorpay Network Error:", err.message);
  }

  // 2. Test Payment Links API capability (used for quotes, invoices & checkout)
  try {
    const linkRes = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: 100, // 1 INR in paise
        currency: "INR",
        accept_partial: false,
        reference_id: "DIAG_" + Date.now(),
        description: "Diagnostic verification test link",
        customer: { name: "Test Verification", contact: "+919014049236" },
        notify: { sms: false, email: false }
      })
    });
    const linkData = await linkRes.json();
    if (linkRes.ok && linkData.short_url) {
      console.log("✅ Razorpay Payment Link Generation: SUCCESS");
      console.log(`   Link ID: ${linkData.id}`);
      console.log(`   Short URL: ${linkData.short_url}`);
    } else {
      console.error("❌ Razorpay Payment Link Failed:", linkData);
    }
  } catch (err) {
    console.error("❌ Razorpay Link Error:", err.message);
  }

  // 3. Test Webhook signature verification against Cloud Run backend
  try {
    const payload = JSON.stringify({
      event: "payment_link.paid",
      payload: {
        payment_link: {
          entity: {
            id: "plink_test_diag",
            amount: 100,
            currency: "INR",
            status: "paid",
            notes: { quoteId: "nonexistent" }
          }
        },
        payment: {
          entity: {
            id: "pay_test_diag_" + Date.now(),
            amount: 100,
            currency: "INR",
            status: "captured"
          }
        }
      }
    });
    const signature = crypto.createHmac("sha256", CONFIG.rzpWebhookSecret).update(payload).digest("hex");
    const hookRes = await fetch(`${CONFIG.cloudRunUrl}/api/webhooks/razorpay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-razorpay-signature": signature
      },
      body: payload
    });
    const hookData = await hookRes.json().catch(() => ({}));
    if (hookRes.status === 200 || hookRes.status === 202) {
      console.log("✅ Cloud Run Razorpay Webhook Handler: SUCCESS (HMAC Signature Verified)");
      console.log("   Response Status:", hookRes.status, hookData);
    } else {
      console.log(`⚠️ Razorpay Webhook Response: ${hookRes.status}`, hookData);
    }
  } catch (err) {
    console.error("❌ Webhook test error:", err.message);
  }
}

async function testShadowfax() {
  console.log("\n--- [2] TESTING SHADOWFAX 360 LOGISTICS INTEGRATION ---");
  const headers = {
    Authorization: `Token ${CONFIG.sfxToken}`,
    "Content-Type": "application/json",
    Accept: "application/json"
  };

  // Test Shadowfax Order tracking / ping endpoint
  try {
    const res = await fetch(`${CONFIG.sfxBaseUrl}/api/v2/clients/orders/DIAGNOSTIC_AWB_PROBE/`, {
      headers
    });
    const data = await res.json().catch(() => ({}));
    // A 404 or order not found from Shadowfax means the token is authenticated and server reached!
    if (res.status === 401 || res.status === 403) {
      console.error("❌ Shadowfax Auth Failed (Invalid Token):", data);
    } else {
      console.log("✅ Shadowfax 360 Master Token Auth: SUCCESS");
      console.log(`   Host: ${CONFIG.sfxBaseUrl}`);
      console.log(`   API Endpoint Reachable: HTTP ${res.status} (${data.message || data.error || 'Server responded cleanly'})`);
    }
  } catch (err) {
    console.error("❌ Shadowfax Connection Error:", err.message);
  }
}

async function testCloudRunAdmin() {
  console.log("\n--- [4] TESTING CLOUD RUN BACKEND SERVICE & CHANNELS ---");
  
  // 1. Health / Public
  try {
    const pubRes = await fetch(`${CONFIG.cloudRunUrl}/`);
    console.log(`✅ Cloud Run Frontend/Backend Serving: HTTP ${pubRes.status}`);
  } catch (err) {
    console.error("❌ Cloud Run ping failed:", err.message);
  }

  // 2. Admin Login
  try {
    const loginRes = await fetch(`${CONFIG.cloudRunUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: CONFIG.adminEmail, password: CONFIG.adminPassword })
    });
    const loginData = await loginRes.json();
    const setCookie = loginRes.headers.get("set-cookie") || "";
    const cookieMatch = setCookie.match(/hc_session=([^;]+)/);
    const sessionCookie = cookieMatch ? `hc_session=${cookieMatch[1]}` : "";

    if (loginRes.ok && loginData.id) {
      console.log("✅ Cloud Run Admin Auth: SUCCESS (Session Created)");
      console.log(`   Logged in Admin: ${loginData.name} (${loginData.email})`);
      console.log(`   Role: ${loginData.role.toUpperCase()}`);
      
      // 3. Check Channel Status
      const chRes = await fetch(`${CONFIG.cloudRunUrl}/api/admin/channels`, {
        headers: { Cookie: sessionCookie }
      });
      const chData = await chRes.json();
      console.log("✅ Live Channel Status from Backend:");
      console.log("   • WhatsApp Outbound:", chData.whatsappOutbound);
      console.log("   • WhatsApp Inbound:", chData.whatsappInbound);
      console.log("   • Payments:", chData.payments);
      console.log("   • Shadowfax Logistics:", chData.shadowfax);

      // 4. Check Delivery Wallet & Courier Hubs
      const hubRes = await fetch(`${CONFIG.cloudRunUrl}/api/admin/hubs/logistics`, {
        headers: { Cookie: sessionCookie }
      });
      const hubData = await hubRes.json();
      console.log("✅ Hub & Courier Wallet Status:");
      console.log(`   • Shadowfax Wallet Balance: ₹${((hubData.wallets?.shadowfax?.balance || 0) / 100).toFixed(2)}`);
      console.log(`   • Low Balance Alert Threshold: ₹${((hubData.wallets?.shadowfax?.lowAt || 0) / 100).toFixed(2)}`);

      // 5. Check Live Shadowfax Status
      const sfxRes = await fetch(`${CONFIG.cloudRunUrl}/api/admin/logistics/shadowfax/status`, {
        headers: { Cookie: sessionCookie }
      });
      const sfxData = await sfxRes.json();
      console.log("🚚 Live Shadowfax Status on Cloud Run:", sfxData);
    } else {
      console.error("❌ Admin Login Failed:", loginData);
    }
  } catch (err) {
    console.error("❌ Admin Test Error:", err.message);
  }
}

async function testWhatsApp() {
  console.log("\n--- [3] TESTING META WHATSAPP CLOUD API (GRAPH V21.0) ---");
  
  // 1. Phone Number Status
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${CONFIG.waPhoneId}?fields=verified_name,code_verification_status,display_phone_number,quality_rating,status`, {
      headers: { Authorization: `Bearer ${CONFIG.waToken}` }
    });
    const data = await res.json();
    if (res.ok) {
      console.log("✅ WhatsApp Phone Number Verified: SUCCESS");
      console.log(`   Display Phone: ${data.display_phone_number}`);
      console.log(`   Verified Name: ${data.verified_name}`);
      console.log(`   Quality Rating: ${data.quality_rating}`);
    } else {
      console.error("❌ WhatsApp Phone API Error:", data.error?.message || data);
    }
  } catch (err) {
    console.error("❌ WhatsApp Network Error:", err.message);
  }

  // 2. Templates Status
  try {
    const tRes = await fetch(`https://graph.facebook.com/v21.0/${CONFIG.waWabaId}/message_templates?fields=name,status,category,language`, {
      headers: { Authorization: `Bearer ${CONFIG.waToken}` }
    });
    const tData = await tRes.json();
    if (tRes.ok) {
      const templates = tData.data || [];
      console.log(`✅ WhatsApp Business Templates: Found ${templates.length} templates`);
      const keyTemplates = ["hc_quote", "hc_invoice", "hc_dispatch", "hc_otp", "hc_update"];
      for (const name of keyTemplates) {
        const found = templates.find(t => t.name === name);
        if (found) {
          console.log(`   • ${found.name}: [${found.status.toUpperCase()}] (${found.category})`);
        } else {
          console.log(`   • ${name}: [NOT FOUND YET]`);
        }
      }
    } else {
      console.error("❌ WhatsApp Templates Error:", tData.error?.message || tData);
    }
  } catch (err) {
    console.error("❌ WhatsApp Templates Error:", err.message);
  }
}


async function run() {
  console.log("=================================================");
  console.log("  HATIKVAH CARE ENTERPRISE BACKEND VERIFICATION  ");
  console.log("=================================================");
  await testRazorpay();
  await testShadowfax();
  await testWhatsApp();
  await testCloudRunAdmin();
  console.log("\n=================================================");
  console.log("              VERIFICATION COMPLETE              ");
  console.log("=================================================");
}

run().catch(console.error);
