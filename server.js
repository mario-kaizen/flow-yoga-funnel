// FLOW Yoga founding-list funnel | join.findyourflow.com.au
// Static pages + lead capture. Leads always land in the JSONL ledger first;
// GHL push happens on top when GHL_PIT + GHL_LOCATION_ID are configured.
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const LEDGER = path.join(DATA_DIR, "leads.jsonl");
const FLOW_FIELD_IDS = {
  heat: process.env.GHL_FIELD_HEAT || "5cfR28VQe7ZV0R3IbxSJ",
  level: process.env.GHL_FIELD_LEVEL || "iJUcb32VwQOuNXCp0AK4",
  flow: process.env.GHL_FIELD_FLOW || "GXjhg0Jh3tqwr6t0RjJB",
  page: process.env.GHL_FIELD_PAGE || "ELyjCRnre3sBJg5LN5IA",
  utm_source: process.env.GHL_FIELD_UTM_SOURCE || "PO8orhrD6coQDTCwmt8W",
  utm_medium: process.env.GHL_FIELD_UTM_MEDIUM || "cXmOT46eIarfQBkcissZ",
  utm_campaign: process.env.GHL_FIELD_UTM_CAMPAIGN || "raZ2ou6N4UISnCOcpuRZ",
  fbclid: process.env.GHL_FIELD_FBCLID || "lmFkU1OjxuRtpz6tD8W3",
  fbc: process.env.GHL_FIELD_FBC || "cjpM9f2l4A6dJqWJsliX",
  fbp: process.env.GHL_FIELD_FBP || "januS1dVdy8exa9QMfpw",
  consent: process.env.GHL_FIELD_CONSENT || "E4SSCP3ljV7kLvYBfvDd",
};
const FIELD_LABELS = {
  heat: { high: "High heat", med: "Medium heat", low: "Low heat" },
  level: { "1": "Advanced", "2": "Intermediate", "3": "Foundation" },
  flow: { a: "Dynamic", b: "Slow", c: "Mellow" },
};

fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.post("/api/register", async (req, res) => {
  const b = req.body || {};
  if (b.hp) return res.json({ ok: true }); // honeypot: swallow silently
  const email = String(b.email || "").trim().toLowerCase();
  const name = String(b.name || "").trim();
  const phone = String(b.phone || "").trim();
  if (!email || !email.includes("@") || !name) {
    return res.status(400).json({ ok: false, error: "name and email required" });
  }

  const lead = {
    ts: new Date().toISOString(),
    name,
    email,
    phone,
    consent: !!b.consent,
    heat: String(b.heat || ""),
    level: String(b.level || ""),
    flow: String(b.flow || ""),
    utm_source: String(b.utm_source || ""),
    utm_medium: String(b.utm_medium || ""),
    utm_campaign: String(b.utm_campaign || ""),
    fbclid: String(b.fbclid || ""),
    fbc: String(b.fbc || ""),
    fbp: String(b.fbp || ""),
    page: String(b.page || ""),
    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "",
    ua: req.headers["user-agent"] || "",
    ghl: "pending",
  };

  lead.ghl = await pushToGhl(lead);
  fs.appendFileSync(LEDGER, JSON.stringify(lead) + "\n");
  res.json({ ok: true });
});

async function pushToGhl(lead) {
  const pit = process.env.GHL_PIT;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!pit || !locationId) return "not-configured";
  try {
    const r = await fetch("https://services.leadconnectorhq.com/contacts/upsert", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pit}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        locationId,
        name: lead.name,
        email: lead.email,
        phone: lead.phone || undefined,
        source: "Founding List | join.findyourflow.com.au",
        tags: ["founding-list", "flow-funnel"],
        customFields: customFieldsForGhl(lead),
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) {
      console.error("GHL upsert failed", r.status, (await r.text()).slice(0, 300));
      return `failed-${r.status}`;
    }
    return "ok";
  } catch (err) {
    console.error("GHL upsert error", err.message);
    return "error";
  }
}

function customFieldsForGhl(lead) {
  const values = {
    heat: FIELD_LABELS.heat[lead.heat] || lead.heat,
    level: FIELD_LABELS.level[lead.level] || lead.level,
    flow: FIELD_LABELS.flow[lead.flow] || lead.flow,
    page: lead.page,
    utm_source: lead.utm_source,
    utm_medium: lead.utm_medium,
    utm_campaign: lead.utm_campaign,
    fbclid: lead.fbclid,
    fbc: lead.fbc,
    fbp: lead.fbp,
    consent: lead.consent ? "Yes" : "No",
  };
  return Object.entries(values)
    .filter(([key, value]) => FLOW_FIELD_IDS[key] && value)
    .map(([key, value]) => ({ id: FLOW_FIELD_IDS[key], value }));
}

// Secret-gated stats for the Lighthouse registry (header auth only, never query param)
app.get("/api/stats", (req, res) => {
  const secret = process.env.STATS_SECRET;
  if (!secret || req.headers["x-lighthouse-secret"] !== secret) {
    return res.status(401).json({ ok: false });
  }
  let rows = [];
  try {
    rows = fs.readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  } catch (_e) {
    /* no leads yet */
  }
  const weekAgo = Date.now() - 7 * 864e5;
  res.json({
    ok: true,
    totalLeads: rows.length,
    leadsLast7d: rows.filter((r) => Date.parse(r.ts) > weekAgo).length,
    lastLeadAt: rows.length ? rows[rows.length - 1].ts : null,
  });
});

app.listen(PORT, () => console.log(`flow-yoga-funnel listening on :${PORT}`));
