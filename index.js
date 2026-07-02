import express from "express";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WATI_API_TOKEN = process.env.WATI_API_TOKEN;
const WATI_BASE_URL = process.env.WATI_BASE_URL;
const AGENT_TRIGGER_ID = process.env.AGENT_TRIGGER_ID;

// Demo simple en memoria. En producción usa Redis o DB.
const sessions = new Map();

app.get("/", (_req, res) => {
  res.send("Wati bridge OK");
});

app.post("/webhook/wati", async (req, res) => {
  try {
    console.log("WATI PAYLOAD:", JSON.stringify(req.body, null, 2));

    const incoming = extractWatiMessage(req.body);
    if (!incoming?.phone || !incoming?.text?.trim()) {
      return res.sendStatus(200);
    }

    const { phone, text } = incoming;
    const conversationId = sessions.get(phone);

    const agentResult = await sendMessageToAgent({
      message: text,
      userId: phone,
      conversationId,
    });

    if (agentResult.conversationId) {
      sessions.set(phone, agentResult.conversationId);
    }

    await sendWatiTextMessage({
      phone,
      text: agentResult.outputText,
    });

    return res.sendStatus(200);
  } catch (error) {
    console.error("WEBHOOK ERROR:", error);
    return res.sendStatus(500);
  }
});

function extractWatiMessage(body) {
  return {
    phone:
      body?.waId ||
      body?.whatsappNumber ||
      body?.data?.waId ||
      body?.data?.whatsappNumber ||
      body?.sender?.waId ||
      null,
    text:
      body?.text ||
      body?.message ||
      body?.data?.text ||
      body?.data?.message ||
      body?.text?.body ||
      null,
  };
}

async function sendMessageToAgent({ message, userId, conversationId }) {
  const payload = {
    input: message,
    user: userId,
  };

  if (conversationId) payload.conversation_id = conversationId;

  const resp = await fetch(
    `https://api.openai.com/v1/agent_triggers/${AGENT_TRIGGER_ID}/runs`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    }
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Agent API error: ${resp.status} ${text}`);
  }

  const data = await resp.json();

  return {
    conversationId: data.conversation_id,
    outputText: extractAgentText(data),
  };
}

function extractAgentText(data) {
  if (data.output_text) return data.output_text;

  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part?.text) return part.text;
        }
      }
    }
  }

  return "No pude generar una respuesta.";
}

async function sendWatiTextMessage({ phone, text }) {
  const resp = await fetch(
    `${WATI_BASE_URL}/api/v1/sendSessionMessage/${encodeURIComponent(phone)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WATI_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messageText: text,
      }),
    }
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Wati send error: ${resp.status} ${err}`);
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
