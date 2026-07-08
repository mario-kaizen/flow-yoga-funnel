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
