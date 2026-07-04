import fs from "fs";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database("cnwifi.db");

db.exec(`
CREATE TABLE IF NOT EXISTS pagamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mercado_pago_id TEXT UNIQUE,
  plano_id TEXT NOT NULL,
  plano_nome TEXT NOT NULL,
  minutos INTEGER NOT NULL,
  valor REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  qr_code TEXT,
  qr_code_base64 TEXT,
  ticket_url TEXT,
  voucher TEXT,
  criado_em TEXT NOT NULL,
  aprovado_em TEXT,
  expira_em TEXT
);

CREATE TABLE IF NOT EXISTS acessos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher TEXT UNIQUE NOT NULL,
  mercado_pago_id TEXT NOT NULL,
  mac TEXT,
  ip TEXT,
  status TEXT NOT NULL DEFAULT 'ativo',
  liberado_em TEXT NOT NULL,
  expira_em TEXT NOT NULL
);
`);

const planos = [
  { id: "5m", nome: "5 minutos", minutos: 5, preco: 1 },
  { id: "10m", nome: "10 minutos", minutos: 10, preco: 2 },
  { id: "30m", nome: "30 minutos", minutos: 30, preco: 3 },
  { id: "1h", nome: "1 hora", minutos: 60, preco: 4 },
  { id: "6h", nome: "6 horas", minutos: 360, preco: 5 },
  { id: "24h", nome: "24 horas", minutos: 1440, preco: 10 },
];


async function buscarClienteOpenNdsPorIp(ip) {
  const { exec } = await import("child_process");

  return new Promise((resolve, reject) => {
    exec("sudo /usr/bin/ndsctl status", (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(stderr || error.message));
      }

      const linhas = stdout.split("\n");

      for (const linha of linhas) {
        if (linha.includes("IP:") && linha.includes("MAC:")) {
          const ipMatch = linha.match(/IP:\s*([^\s]+)/);
          const macMatch = linha.match(/MAC:\s*([^\s]+)/);

          if (ipMatch?.[1] === ip) {
            return resolve({
              ip: ipMatch[1],
              mac: macMatch?.[1],
            });
          }
        }
      }

      resolve(null);
    });
  });
}

async function liberarClienteOpenNds(mac) {
  const { exec } = await import("child_process");

  return new Promise((resolve, reject) => {
    exec(`sudo /usr/bin/ndsctl auth ${mac}`, (error, stdout, stderr) => {
      if (error && !String(stdout).toLowerCase().includes("authenticated")) {
        return reject(new Error(stderr || stdout || error.message));
      }

      resolve(stdout || "Cliente liberado.");
    });
  });
}

function gerarVoucher() {
  return "CN-" + randomUUID().slice(0, 8).toUpperCase();
}

app.get("/", (req, res) => {
  res.json({ status: "online", sistema: "CN WiFi Backend" });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Backend CN WiFi funcionando" });
});

app.get("/api/planos", (req, res) => {
  res.json(planos);
});

app.post("/api/pagamentos/pix", async (req, res) => {
  try {
    const { planoId } = req.body;
    const email = "cliente@cnwifi.com.br";
    const plano = planos.find((item) => item.id === planoId);

    if (!plano) {
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
        transaction_amount: plano.preco,
        description: `CN WiFi - ${plano.nome}`,
        payment_method_id: "pix",
        payer: { email: email || "teste@teste.com" },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        erro: "Erro ao criar pagamento PIX",
        detalhes: data,
      });
    }

    const qrCode = data.point_of_interaction?.transaction_data?.qr_code;
    const qrCodeBase64 = data.point_of_interaction?.transaction_data?.qr_code_base64;
    const ticketUrl = data.point_of_interaction?.transaction_data?.ticket_url;

    db.prepare(`
      INSERT INTO pagamentos
      (mercado_pago_id, plano_id, plano_nome, minutos, valor, status, qr_code, qr_code_base64, ticket_url, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(data.id),
      plano.id,
      plano.nome,
      plano.minutos,
      plano.preco,
      data.status,
      qrCode,
      qrCodeBase64,
      ticketUrl,
      new Date().toISOString()
    );

    res.json({
      pagamentoId: data.id,
      status: data.status,
      plano,
      qrCode,
      qrCodeBase64,
      ticketUrl,
    });
  } catch (error) {
    res.status(500).json({
      erro: "Erro interno ao criar PIX",
      detalhes: error.message,
    });
  }
});


app.get("/api/pagamentos/:id/status", async (req, res) => {
  try {
    const pagamentoId = req.params.id;

    const pagamentoLocal = db.prepare(
      "SELECT * FROM pagamentos WHERE mercado_pago_id = ?"
    ).get(String(pagamentoId));

    if (!pagamentoLocal) {
      return res.status(404).json({ erro: "Pagamento não encontrado." });
    }

    if (pagamentoLocal.status === "approved") {
      return res.json({
        pagamentoId,
        status: "approved",
        aprovado: true,
        voucher: pagamentoLocal.voucher,
        expiraEm: pagamentoLocal.expira_em,
      });
    }

    const response = await fetch(`https://api.mercadopago.com/v1/payments/${pagamentoId}`, {
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        erro: "Erro ao consultar pagamento",
        detalhes: data,
      });
    }

    let voucher = pagamentoLocal.voucher;
    let expiraEm = pagamentoLocal.expira_em;

    if (data.status === "approved") {
      voucher = gerarVoucher();
      const aprovadoEm = new Date();
      const expira = new Date(aprovadoEm.getTime() + pagamentoLocal.minutos * 60000);
      expiraEm = expira.toISOString();

      db.prepare(`
        UPDATE pagamentos
        SET status = ?, voucher = ?, aprovado_em = ?, expira_em = ?
        WHERE mercado_pago_id = ?
      `).run("approved", voucher, aprovadoEm.toISOString(), expiraEm, String(pagamentoId));
    } else {
      db.prepare(`
        UPDATE pagamentos
        SET status = ?
        WHERE mercado_pago_id = ?
      `).run(data.status, String(pagamentoId));
    }

    let internetLiberada = false;
    let clienteOpenNds = null;
    let erroLiberacao = null;

    const clienteIp = req.query.ip;

    if (data.status === "approved" && clienteIp) {
      try {
        clienteOpenNds = await buscarClienteOpenNdsPorIp(clienteIp);

        if (clienteOpenNds?.mac) {
          await liberarClienteOpenNds(clienteOpenNds.mac);
          internetLiberada = true;
        }
      } catch (error) {
        erroLiberacao = error.message;
      }
    }

    res.json({
      pagamentoId,
      status: data.status,
      aprovado: data.status === "approved",
      voucher,
      expiraEm,
      internetLiberada,
      clienteOpenNds,
      erroLiberacao,
    });
  } catch (error) {
    res.status(500).json({
      erro: "Erro ao consultar status",
      detalhes: error.message,
    });
  }
});


app.get("/api/admin/pagamentos", (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM pagamentos
    ORDER BY id DESC
    LIMIT 100
  `).all();

  res.json(rows);
});


app.post("/api/admin/pagamentos/:id/aprovar", (req, res) => {
  const pagamentoId = req.params.id;

  const pagamento = db.prepare(
    "SELECT * FROM pagamentos WHERE mercado_pago_id = ?"
  ).get(String(pagamentoId));

  if (!pagamento) {
    return res.status(404).json({ erro: "Pagamento não encontrado." });
  }

  const voucher = pagamento.voucher || gerarVoucher();
  const aprovadoEm = new Date();
  const expira = new Date(aprovadoEm.getTime() + pagamento.minutos * 60000);

  db.prepare(`
    UPDATE pagamentos
    SET status = ?, voucher = ?, aprovado_em = ?, expira_em = ?
    WHERE mercado_pago_id = ?
  `).run(
    "approved",
    voucher,
    aprovadoEm.toISOString(),
    expira.toISOString(),
    String(pagamentoId)
  );

  res.json({
    ok: true,
    pagamentoId,
    status: "approved",
    voucher,
    expiraEm: expira.toISOString()
  });
});


app.post("/api/acesso/ativar", (req, res) => {
  const { voucher, mac, ip } = req.body;

  if (!voucher) {
    return res.status(400).json({ erro: "Voucher obrigatório." });
  }

  const pagamento = db.prepare(
    "SELECT * FROM pagamentos WHERE voucher = ? AND status = 'approved'"
  ).get(voucher);

  if (!pagamento) {
    return res.status(404).json({ erro: "Voucher inválido ou não aprovado." });
  }

  const agora = new Date();
  const expira = new Date(pagamento.expira_em);

  if (expira <= agora) {
    return res.status(403).json({ erro: "Voucher expirado." });
  }

  db.prepare(`
    INSERT OR REPLACE INTO acessos
    (voucher, mercado_pago_id, mac, ip, status, liberado_em, expira_em)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    voucher,
    pagamento.mercado_pago_id,
    mac || null,
    ip || null,
    "ativo",
    agora.toISOString(),
    pagamento.expira_em
  );

  res.json({
    ok: true,
    liberado: true,
    voucher,
    expiraEm: pagamento.expira_em
  });
});

app.get("/api/admin/acessos", (req, res) => {
  const acessos = db.prepare(`
    SELECT * FROM acessos
    ORDER BY id DESC
    LIMIT 100
  `).all();

  res.json(acessos);
});



app.post("/api/opennds/auth", async (req, res) => {
  try {
    const { mac } = req.body;

    if (!mac) {
      return res.status(400).json({ erro: "MAC obrigatório." });
    }

    const { exec } = await import("child_process");

    exec(`sudo /usr/bin/ndsctl auth ${mac}`, (error, stdout, stderr) => {
      const saida = `${stdout || ""}${stderr || ""}`;

      if (error && !saida.toLowerCase().includes("authenticated")) {
        return res.status(500).json({
          erro: "Erro ao liberar cliente no OpenNDS",
          code: error.code,
          stdout,
          stderr,
          detalhes: error.message,
        });
      }

      res.json({
        ok: true,
        liberado: true,
        mac,
        resposta: saida || "Cliente liberado ou já autenticado.",
      });
    });
  } catch (error) {
    res.status(500).json({
      erro: "Erro interno",
      detalhes: error.message,
    });
  }
});


app.get("/api/opennds/cliente-atual", async (req, res) => {
  try {
    const ip = req.query.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress;

    const { exec } = await import("child_process");

    exec("sudo /usr/bin/ndsctl status", (error, stdout, stderr) => {
      if (error) {
        return res.status(500).json({
          erro: "Erro ao consultar OpenNDS",
          detalhes: stderr || error.message,
        });
      }

      const linhas = stdout.split("\n");
      let cliente = null;

      for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i];

        if (linha.includes("IP:") && linha.includes("MAC:")) {
          const ipMatch = linha.match(/IP:\s*([^\s]+)/);
          const macMatch = linha.match(/MAC:\s*([^\s]+)/);

          const encontrado = {
            ip: ipMatch?.[1],
            mac: macMatch?.[1],
          };

          if (!ip || ip.includes(encontrado.ip)) {
            cliente = encontrado;
            break;
          }
        }
      }

      if (!cliente) {
        return res.status(404).json({
          erro: "Cliente não encontrado no OpenNDS.",
          ipDetectado: ip,
        });
      }

      res.json({
        ok: true,
        cliente,
      });
    });
  } catch (error) {
    res.status(500).json({
      erro: "Erro interno",
      detalhes: error.message,
    });
  }
});


const CONFIG_PATH = "./cnwifi-config.json";

function lerConfigCnWifi() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const padrao = {
      senhaAdmin: "1234",
      fimPermanencia: "",
      planosAtivos: ["5m", "10m", "30m", "1h", "6h", "24h"]
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(padrao, null, 2));
    return padrao;
  }

  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

app.get("/api/config", (req, res) => {
  res.json(lerConfigCnWifi());
});

app.put("/api/config", (req, res) => {
  const atual = lerConfigCnWifi();
  const novo = { ...atual, ...req.body };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(novo, null, 2));
  res.json({ ok: true, config: novo });
});



app.post("/api/opennds/liberar-temporario", async (req, res) => {
  try {
    const { ip, segundos = 90 } = req.body;

    if (!ip) {
      return res.status(400).json({ erro: "IP obrigatório." });
    }

    const cliente = await buscarClienteOpenNdsPorIp(ip);

    if (!cliente?.mac) {
      return res.status(404).json({ erro: "Cliente não encontrado no OpenNDS." });
    }

    await liberarClienteOpenNds(cliente.mac);

    setTimeout(async () => {
      try {
        const { exec } = await import("child_process");
        exec(`sudo /usr/bin/ndsctl deauth ${cliente.mac}`, () => {});
      } catch {}
    }, Number(segundos) * 1000);

    res.json({
      ok: true,
      liberadoTemporario: true,
      segundos,
      cliente
    });
  } catch (error) {
    res.status(500).json({
      erro: "Erro ao liberar temporariamente.",
      detalhes: error.message
    });
  }
});


function parseClientesOpenNds(status) {
  const blocos = status.split(/\nClient \d+\n/).slice(1);

  return blocos.map((bloco) => {
    const ip = bloco.match(/IP:\s*([^\s]+)/)?.[1] || "";
    const mac = bloco.match(/MAC:\s*([^\s]+)/)?.[1] || "";
    const state = bloco.match(/State:\s*(.+)/)?.[1]?.trim() || "";
    const sessionStart = bloco.match(/Session Start:\s*(.+)/)?.[1]?.trim() || "";
    const sessionEnd = bloco.match(/Session End:\s*(.+)/)?.[1]?.trim() || "";
    const download = bloco.match(/Download this session:\s*(.+)/)?.[1]?.trim() || "";
    const upload = bloco.match(/Upload this session:\s*(.+)/)?.[1]?.trim() || "";

    return { ip, mac, state, sessionStart, sessionEnd, download, upload };
  }).filter(c => c.mac);
}

app.get("/api/admin/clientes", async (req, res) => {
  try {
    const { exec } = await import("child_process");

    exec("sudo /usr/bin/ndsctl status", (error, stdout, stderr) => {
      if (error) {
        return res.status(500).json({
          ok: false,
          erro: stderr || error.message,
        });
      }

      res.json({
        ok: true,
        clientes: parseClientesOpenNds(stdout),
        bruto: stdout,
      });
    });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});

app.post("/api/admin/clientes/desconectar", async (req, res) => {
  try {
    const { mac } = req.body;

    if (!mac) {
      return res.status(400).json({ ok: false, erro: "MAC obrigatório." });
    }

    const { exec } = await import("child_process");

    exec(`sudo /usr/bin/ndsctl deauth ${mac}`, (error, stdout, stderr) => {
      res.json({
        ok: true,
        mac,
        resposta: stdout || stderr || "Comando executado.",
      });
    });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});

app.post("/api/admin/clientes/limpar", async (req, res) => {
  try {
    const { exec } = await import("child_process");

    exec("sudo /usr/bin/ndsctl status", (error, stdout) => {
      const clientes = parseClientesOpenNds(stdout || "");

      clientes.forEach((cliente) => {
        exec(`sudo /usr/bin/ndsctl deauth ${cliente.mac}`, () => {});
      });

      res.json({
        ok: true,
        removidos: clientes.length,
        clientes,
      });
    });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`CN WiFi Backend rodando em http://localhost:${PORT}`);
});
