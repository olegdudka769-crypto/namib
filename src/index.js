const RESEND_API_URL = "https://api.resend.com/emails";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const THANKS_PATH = {
  ru: "/thanks.html",
  en: "/en/thanks.html",
};

function redirectToThanks(lang) {
  const location = THANKS_PATH[lang] || THANKS_PATH.ru;
  return new Response(null, { status: 303, headers: { Location: location } });
}

function isValidEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function randomId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

async function verifyTurnstile(token, secret, ip) {
  if (!secret) return false;
  if (!token) return false;
  try {
    const body = new URLSearchParams();
    body.set("secret", secret);
    body.set("response", token);
    if (ip) body.set("remoteip", ip);
    const resp = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await resp.json();
    return data.success === true;
  } catch (err) {
    return false;
  }
}

function buildNotificationEmail(lead) {
  const rows = [
    ["Имя", lead.name],
    ["Email", lead.email],
    ["Телефон / WhatsApp", lead.phone || "—"],
    ["Сообщение", lead.message || "—"],
    ["Язык страницы", lead.lang],
    ["Страница", lead.page],
    ["Страна (IP)", lead.country || "—"],
    ["Дата", lead.createdAt],
  ];
  const html = `<h2>Новая заявка: ${escapeHtml(lead.name)}</h2><table>${rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6a6a6a;">${escapeHtml(label)}</td><td style="padding:4px 0;">${escapeHtml(value)}</td></tr>`
    )
    .join("")}</table>`;
  return {
    from: "Namib Passage Leads <leads@namibpassage.com>",
    to: ["leads@namibpassage.com"],
    reply_to: lead.email,
    subject: `Новая заявка: ${lead.name}`,
    html,
  };
}

function buildAutoresponse(lead) {
  const isRu = lead.lang !== "en";
  const subject = isRu ? "Namib Passage — заявка получена" : "Namib Passage — request received";
  const greeting = isRu ? `Здравствуйте, ${escapeHtml(lead.name)}.` : `Hello ${escapeHtml(lead.name)},`;
  const body = isRu
    ? `<p>${greeting}</p><p>Спасибо за обращение в Namib Passage. Мы получили вашу заявку и свяжемся с вами в течение 24 часов.</p><p>Если у вас срочный вопрос, вы можете ответить на это письмо.</p><p>С уважением,<br>Команда Namib Passage<br><a href="https://namibpassage.com/">namibpassage.com</a></p>`
    : `<p>${greeting}</p><p>Thank you for reaching out to Namib Passage. We've received your request and will get back to you within 24 hours.</p><p>If your matter is urgent, feel free to reply to this email.</p><p>Best regards,<br>The Namib Passage Team<br><a href="https://namibpassage.com/">namibpassage.com</a></p>`;
  return {
    from: "Namib Passage <hello@namibpassage.com>",
    to: [lead.email],
    reply_to: "hello@namibpassage.com",
    subject,
    html: body,
  };
}

async function sendResendEmail(apiKey, payload) {
  if (!apiKey) return false;
  try {
    const resp = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return resp.ok;
  } catch (err) {
    return false;
  }
}

async function handleLead(request, env) {
  const formData = await request.formData();

  const honeypot = (formData.get("company") || "").toString().trim();
  const name = (formData.get("name") || "").toString().trim();
  const email = (formData.get("email") || "").toString().trim();
  const phone = (formData.get("phone") || "").toString().trim();
  const message = (formData.get("message") || "").toString().trim();
  const consent = formData.get("consent");
  const lang = (formData.get("lang") || "ru").toString().trim() === "en" ? "en" : "ru";
  const page = (formData.get("page") || "/").toString().trim();
  const turnstileToken = (formData.get("cf-turnstile-response") || "").toString();

  if (honeypot) {
    return redirectToThanks(lang);
  }

  if (!name || !isValidEmail(email) || !consent) {
    return new Response("Invalid submission", { status: 400 });
  }

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const turnstileOk = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, ip);
  if (!turnstileOk) {
    return new Response("Turnstile verification failed", { status: 400 });
  }

  const country = request.cf && request.cf.country ? request.cf.country : "";
  const createdAt = new Date().toISOString();
  const lead = { name, email, phone, message, lang, page, country, createdAt };

  const key = `lead:${createdAt}:${randomId()}`;
  try {
    await env.LEADS.put(key, JSON.stringify(lead));
  } catch (err) {
    // Storage failure should not block the user, but we still try to notify.
  }

  await Promise.allSettled([
    sendResendEmail(env.RESEND_API_KEY, buildNotificationEmail(lead)),
    sendResendEmail(env.RESEND_API_KEY, buildAutoresponse(lead)),
  ]);

  return redirectToThanks(lang);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/lead") {
      return handleLead(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
