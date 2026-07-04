import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const planosBase = [
  { id: "5m", nome: "5 minutos", minutos: 5, preco: 1 },
  { id: "10m", nome: "10 minutos", minutos: 10, preco: 2 },
  { id: "30m", nome: "30 minutos", minutos: 30, preco: 3 },
  { id: "1h", nome: "1 hora", minutos: 60, preco: 4 },
  { id: "6h", nome: "6 horas", minutos: 360, preco: 5 },
  { id: "24h", nome: "24 horas", minutos: 1440, preco: 10 },
];

function gerarVoucher() {
  return "CN-" + randomUUID().slice(0, 8).toUpperCase();
}

app.get("/", (req, res) => {
  res.json({ status: "online", sistema: "CN WiFi Backend Supabase" });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Backend CN WiFi funcionando com Supabase" });
});

app.get("/api/debug/env", (req, res) => {
  const mp = process.env.MP_ACCESS_TOKEN || "";
  res.json({
    ok: true,
    supabaseUrl: !!process.env.SUPABASE_URL,
    supabaseKey: !!process.env.SUPABASE_SERVICE_KEY,
    mpTokenExiste: !!mp,
    mpTokenInicio: mp ? mp.slice(0, 8) : null,
    mpTokenTamanho: mp.length
  });
});

app.get("/api/planos", async (req, res) => {
  const { data, error } = await supabase
    .from("planos")
    .select("*")
    .order("minutos");

  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
});

app.get("/api/config", async (req, res) => {
  const { data: config, error } = await supabase
    .from("configuracoes")
    .select("*")
    .eq("id", "principal")
    .single();

  if (error) return res.status(500).json({ erro: error.message });

  const { data: planos } = await supabase
    .from("planos")
    .select("id")
    .eq("ativo", true);

  res.json({
    senhaAdmin: config?.senha_admin || "1234",
    fimPermanencia: config?.fim_permanencia || "",
    planosAtivos: (planos || []).map((p) => p.id),
  });
});

app.put("/api/config", async (req, res) => {
  const { senhaAdmin, fimPermanencia, planosAtivos } = req.body;

  const { error: cfgError } = await supabase
    .from("configuracoes")
    .upsert({
      id: "principal",
      senha_admin: senhaAdmin || "1234",
      fim_permanencia: fimPermanencia || null,
      atualizado_em: new Date().toISOString(),
    });

  if (cfgError) return res.status(500).json({ erro: cfgError.message });

  if (Array.isArray(planosAtivos)) {
    for (const plano of planosBase) {
      await supabase
        .from("planos")
        .update({ ativo: planosAtivos.includes(plano.id) })
        .eq("id", plano.id);
    }
  }

  res.json({ ok: true });
});

app.post("/api/pagamentos/pix", async (req, res) => {
  try {
    const { planoId } = req.body;
    const emailRecebido = String(req.body?.email || "").trim();
    const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRecebido);
    const email = emailValido ? emailRecebido : "cliente@cnwifi.com";

    const { data: plano, error: planoError } = await supabase
      .from("planos")
      .select("*")
      .eq("id", planoId)
      .single();

    if (planoError || !plano) {
      return res.status(404).json({ erro: "Plano não encontrado." });
    }

    const response = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        "X-Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        transaction_amount: Number(plano.preco),
        description: `CN WiFi - ${plano.nome}`,
        payment_method_id: "pix",
        payer: { email },
      }),
    });

    const mp = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        erro: "Erro ao criar pagamento PIX",
        detalhes: mp,
      });
    }

    const qrCode = mp.point_of_interaction?.transaction_data?.qr_code;
    const qrCodeBase64 = mp.point_of_interaction?.transaction_data?.qr_code_base64;
    const ticketUrl = mp.point_of_interaction?.transaction_data?.ticket_url;

    const { error: insertError } = await supabase.from("pagamentos").insert({
      mercado_pago_id: String(mp.id),
      plano_id: plano.id,
      plano_nome: plano.nome,
      minutos: plano.minutos,
      valor: plano.preco,
      status: mp.status,
      metodo: "pix",
      qr_code: qrCode,
      qr_code_base64: qrCodeBase64,
      ticket_url: ticketUrl,
    });

    if (insertError) {
      return res.status(500).json({ erro: insertError.message });
    }

    res.json({
      pagamentoId: mp.id,
      status: mp.status,
      plano: {
        id: plano.id,
        nome: plano.nome,
        minutos: plano.minutos,
        preco: Number(plano.preco),
      },
      qrCode,
      qrCodeBase64,
      ticketUrl,
    });
  } catch (error) {
    res.status(500).json({ erro: "Erro interno ao criar PIX", detalhes: error.message });
  }
});

app.get("/api/pagamentos/:id/status", async (req, res) => {
  try {
    const pagamentoId = req.params.id;

    const { data: pagamento, error } = await supabase
      .from("pagamentos")
      .select("*")
      .eq("mercado_pago_id", String(pagamentoId))
      .single();

    if (error || !pagamento) {
      return res.status(404).json({ erro: "Pagamento não encontrado." });
    }

    if (pagamento.status === "approved") {
      return res.json({
        pagamentoId,
        status: "approved",
        aprovado: true,
        voucher: pagamento.voucher,
        expiraEm: pagamento.expira_em,
        internetLiberada: false,
      });
    }

    const response = await fetch(`https://api.mercadopago.com/v1/payments/${pagamentoId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    });

    const mp = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        erro: "Erro ao consultar pagamento",
        detalhes: mp,
      });
    }

    let voucher = pagamento.voucher;
    let expiraEm = pagamento.expira_em;

    if (mp.status === "approved") {
      voucher = voucher || gerarVoucher();
      const aprovadoEm = new Date();
      const expira = new Date(aprovadoEm.getTime() + pagamento.minutos * 60000);
      expiraEm = expira.toISOString();

      await supabase
        .from("pagamentos")
        .update({
          status: "approved",
          voucher,
          aprovado_em: aprovadoEm.toISOString(),
          expira_em: expiraEm,
        })
        .eq("mercado_pago_id", String(pagamentoId));
    } else {
      await supabase
        .from("pagamentos")
        .update({ status: mp.status })
        .eq("mercado_pago_id", String(pagamentoId));
    }

    res.json({
      pagamentoId,
      status: mp.status,
      aprovado: mp.status === "approved",
      voucher,
      expiraEm,
      internetLiberada: false,
    });
  } catch (error) {
    res.status(500).json({ erro: "Erro ao consultar status", detalhes: error.message });
  }
});

app.get("/api/admin/pagamentos", async (req, res) => {
  const { data, error } = await supabase
    .from("pagamentos")
    .select("*")
    .order("id", { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
});

app.post("/api/admin/pagamentos/:id/aprovar", async (req, res) => {
  const pagamentoId = req.params.id;

  const { data: pagamento, error } = await supabase
    .from("pagamentos")
    .select("*")
    .eq("mercado_pago_id", String(pagamentoId))
    .single();

  if (error || !pagamento) {
    return res.status(404).json({ erro: "Pagamento não encontrado." });
  }

  const voucher = pagamento.voucher || gerarVoucher();
  const aprovadoEm = new Date();
  const expira = new Date(aprovadoEm.getTime() + pagamento.minutos * 60000);

  const { error: updateError } = await supabase
    .from("pagamentos")
    .update({
      status: "approved",
      voucher,
      aprovado_em: aprovadoEm.toISOString(),
      expira_em: expira.toISOString(),
    })
    .eq("mercado_pago_id", String(pagamentoId));

  if (updateError) return res.status(500).json({ erro: updateError.message });

  res.json({
    ok: true,
    pagamentoId,
    status: "approved",
    voucher,
    expiraEm: expira.toISOString(),
  });
});

app.get("/api/admin/clientes", async (req, res) => {
  const { data, error } = await supabase
    .from("clientes")
    .select("*")
    .order("id", { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ ok: false, erro: error.message });

  res.json({ ok: true, clientes: data });
});

app.post("/api/admin/clientes/desconectar", async (req, res) => {
  res.json({ ok: true, mensagem: "Desconexão via MikroTik será ativada na próxima etapa." });
});

app.post("/api/admin/clientes/limpar", async (req, res) => {
  res.json({ ok: true, mensagem: "Limpeza via MikroTik será ativada na próxima etapa." });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`CN WiFi Backend Supabase rodando em http://localhost:${PORT}`);
});
