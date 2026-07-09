import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

const planosBase = [
  { id: "5m", nome: "5 minutos", minutos: 5, preco: 1 },
  { id: "10m", nome: "10 minutos", minutos: 10, preco: 2 },
  { id: "30m", nome: "30 minutos", minutos: 30, preco: 3 },
  { id: "1h", nome: "1 hora", minutos: 60, preco: 4 },
  { id: "6h", nome: "6 horas", minutos: 360, preco: 5 },
  { id: "24h", nome: "24 horas", minutos: 1440, preco: 10 },
];

function App() {
  const isAdmin = window.location.pathname === "/admin";

  const [config, setConfig] = useState(null);
  const [senha, setSenha] = useState("");
  const [logado, setLogado] = useState(false);
  const [pagamento, setPagamento] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [clientes, setClientes] = useState([]);
  const [solicitacoes, setSolicitacoes] = useState([]);
  const [dashboard, setDashboard] = useState(null);

  const agoraBR = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

  async function carregarConfig() {
    const { data } = await axios.get(`${API_URL}/api/config`);
    setConfig(data);
  }

  async function carregarDashboard() {
    const { data } = await axios.get(`${API_URL}/api/admin/dashboard`);
    setDashboard(data);
  }

  async function carregarClientes() {
    const { data } = await axios.get(`${API_URL}/api/admin/clientes`);
    setClientes(data.clientes || []);
  }

  async function carregarSolicitacoes() {
    const { data } = await axios.get(`${API_URL}/api/admin/solicitacoes-liberacao`);
    setSolicitacoes(data.solicitacoes || []);
  }

  useEffect(() => {
    carregarConfig();
  }, []);

  useEffect(() => {
    if (isAdmin && logado) {
      carregarDashboard();
      carregarClientes();
      carregarSolicitacoes();
    }
  }, [isAdmin, logado]);

  useEffect(() => {
    const salvo = localStorage.getItem("cnwifi_pagamento");
    if (salvo && !pagamento && !isAdmin) {
      try {
        setPagamento(JSON.parse(salvo));
        setMensagem("Pagamento em andamento. Não feche esta tela.");
      } catch {}
    }
  }, []);

  const planosDisponiveis = useMemo(() => {
    if (!config) return [];
    let planos = planosBase.filter((p) => config.planosAtivos?.includes(p.id));

    if (config.fimPermanencia) {
      const minutosRestantes = Math.floor(
        (new Date(config.fimPermanencia) - new Date()) / 60000
      );
      planos = planos.filter((p) => p.minutos <= minutosRestantes);
    }

    return planos;
  }, [config]);

  useEffect(() => {
    if (!pagamento?.pagamentoId || pagamento.status === "approved") return;

    const timer = setInterval(async () => {
      try {
        const { data } = await axios.get(
          `${API_URL}/api/pagamentos/${pagamento.pagamentoId}/status`
        );

        if (data.aprovado || data.status === "approved") {
          const atualizado = {
            ...pagamento,
            status: "approved",
            voucher: data.voucher || "LIBERADO",
          };

          setPagamento(atualizado);
          localStorage.removeItem("cnwifi_pagamento");
          setMensagem("Pagamento aprovado. Liberando internet...");

          setTimeout(() => liberarInternetMikrotik(), 1500);
        }
      } catch (error) {
        console.error("Erro ao verificar pagamento:", error);
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [pagamento?.pagamentoId, pagamento?.status]);

  function moeda(valor) {
    return Number(valor || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }

  function dataBR(valor) {
    if (!valor) return "-";
    return new Date(valor).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });
  }

  function liberarInternetMikrotik() {
    window.location.href =
      "http://login.cnwifi.local/login?username=cnwifi&password=2529&dst=http://neverssl.com";
  }

  async function comprarPlano(plano) {
    try {
      setCarregando(true);
      setMensagem("");
      setPagamento(null);

      const { data } = await axios.post(`${API_URL}/api/pagamentos/pix`, {
        planoId: plano.id,
        email: "cliente.cnwifi@gmail.com",
      });

      setPagamento(data);
      localStorage.setItem("cnwifi_pagamento", JSON.stringify(data));
      setMensagem("PIX gerado. Não feche esta tela até a liberação.");
    } catch (error) {
      alert(JSON.stringify(error.response?.data || { erro: error.message }, null, 2));
    } finally {
      setCarregando(false);
    }
  }

  async function verificarPagamento() {
    if (!pagamento?.pagamentoId) return;

    setCarregando(true);
    try {
      const { data } = await axios.get(
        `${API_URL}/api/pagamentos/${pagamento.pagamentoId}/status`
      );

      if (!data.aprovado) {
        setMensagem("Pagamento ainda não aprovado. Aguarde alguns segundos.");
        return;
      }

      setPagamento({ ...pagamento, status: "approved", voucher: data.voucher });
      localStorage.removeItem("cnwifi_pagamento");
      setMensagem("Pagamento aprovado. Clique em liberar internet.");
    } finally {
      setCarregando(false);
    }
  }

  async function solicitarLiberacao() {
    if (!pagamento?.pagamentoId) {
      alert("Gere um pagamento primeiro.");
      return;
    }

    await axios.post(`${API_URL}/api/solicitacoes-liberacao`, {
      pagamentoId: pagamento.pagamentoId,
      planoId: pagamento.plano?.id,
      observacao: "Cliente informou que já pagou e pediu liberação.",
    });

    alert("Solicitação enviada. Aguarde a liberação.");
  }

  async function salvarAdmin() {
    await axios.put(`${API_URL}/api/config`, config);
    alert("Configuração salva.");
    carregarConfig();
  }

  async function marcarSolicitacaoLiberada(id) {
    await axios.post(`${API_URL}/api/admin/solicitacoes-liberacao/${id}/marcar-liberada`);
    carregarSolicitacoes();
  }

  async function desconectarCliente(mac) {
    await axios.post(`${API_URL}/api/admin/clientes/desconectar`, { mac });
    carregarClientes();
  }

  async function limparClientes() {
    if (!confirm("Desconectar todos os clientes?")) return;
    await axios.post(`${API_URL}/api/admin/clientes/limpar`);
    carregarClientes();
  }

  if (!config) return <main className="loading">Carregando CN WiFi...</main>;

  if (isAdmin && !logado) {
    return (
      <main className="login-admin">
        <section className="login-box">
          <div className="brand">CN WiFi</div>
          <h1>Painel Administrativo</h1>
          <p>Controle premium do seu ponto de internet.</p>
          <input
            type="password"
            placeholder="Senha do administrador"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
          <button onClick={() => senha === config.senhaAdmin ? setLogado(true) : alert("Senha incorreta.")}>
            Entrar no painel
          </button>
        </section>
      </main>
    );
  }

  if (isAdmin) {
    const resumo = dashboard?.resumo || {};
    const pagamentos = dashboard?.ultimosPagamentos || [];
    const planosVendidos = dashboard?.planosVendidos || {};

    return (
      <main className="admin-shell">
        <aside className="sidebar">
          <div className="logo">CN <span>WiFi</span><small>ADMIN</small></div>
          {["Dashboard", "Clientes", "Pagamentos", "Solicitações", "Financeiro", "Planos", "Configurações"].map((item, i) => (
            <button key={item} className={i === 0 ? "nav active" : "nav"}>{item}</button>
          ))}
          <div className="sidebar-footer">CN WiFi OS v2.0<br />America/Sao_Paulo</div>
        </aside>

        <section className="admin-content">
          <header className="topbar">
            <div>
              <h1>Dashboard</h1>
              <p>Visão geral do seu ponto de internet</p>
            </div>
            <div className="top-actions">
              <span className="online">● Online</span>
              <span>{agoraBR}</span>
              <strong>Administrador</strong>
            </div>
          </header>

          <section className="kpi-grid">
            <div className="kpi blue"><span>Receita hoje</span><strong>{moeda(resumo.receitaHoje)}</strong><small>Pagamentos do dia</small></div>
            <div className="kpi green"><span>Receita semana</span><strong>{moeda(resumo.receitaSemana)}</strong><small>Últimos 7 dias</small></div>
            <div className="kpi purple"><span>Receita mês</span><strong>{moeda(resumo.receitaMes)}</strong><small>Mês atual</small></div>
            <div className="kpi orange"><span>Receita total</span><strong>{moeda(resumo.receitaTotal)}</strong><small>Total acumulado</small></div>
            <div className="kpi blue"><span>Pagamentos hoje</span><strong>{resumo.pagamentosHoje || 0}</strong><small>Aprovados hoje</small></div>
            <div className="kpi green"><span>Pagamentos pagos</span><strong>{resumo.pagamentosTotal || 0}</strong><small>Total aprovado</small></div>
            <div className="kpi purple"><span>Pendentes</span><strong>{resumo.pendentes || 0}</strong><small>Aguardando pagamento</small></div>
            <div className="kpi cyan"><span>Clientes online</span><strong>{clientes.length}</strong><small>Conectados agora</small></div>
          </section>

          <section className="admin-grid">
            <div className="panel chart-panel">
              <div className="panel-head">
                <h2>Receita dos últimos dias</h2>
                <button onClick={carregarDashboard}>Atualizar</button>
              </div>
              <div className="fake-chart">
                {[25, 38, 28, 55, 40, 80, 60].map((h, i) => (
                  <div key={i} style={{ height: `${h}%` }}><span>{moeda((h / 10) || 0)}</span></div>
                ))}
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <h2>Planos mais vendidos</h2>
              </div>
              <div className="plans-ranking">
                {Object.entries(planosVendidos).length === 0 && <p>Nenhum plano vendido ainda.</p>}
                {Object.entries(planosVendidos).map(([nome, qtd]) => (
                  <div key={nome}>
                    <span>{nome}</span>
                    <strong>{qtd}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel side-panel">
              <div className="panel-head">
                <h2>Clientes conectados</h2>
                <button onClick={carregarClientes}>Ver</button>
              </div>
              {clientes.length === 0 && <p>Nenhum cliente conectado no momento.</p>}
              {clientes.slice(0, 4).map((c) => (
                <div className="client-card" key={c.mac}>
                  <div>
                    <strong>{c.mac}</strong>
                    <span>{c.ip || c.address || "-"}</span>
                  </div>
                  <button onClick={() => desconectarCliente(c.mac)}>Desconectar</button>
                </div>
              ))}
            </div>

            <div className="panel side-panel">
              <div className="panel-head">
                <h2>Ações rápidas</h2>
              </div>
              <div className="quick-actions">
                <button onClick={carregarDashboard}>Atualizar dashboard</button>
                <button onClick={carregarClientes}>Atualizar clientes</button>
                <button onClick={carregarSolicitacoes}>Ver solicitações</button>
                <button className="danger" onClick={limparClientes}>Desconectar todos</button>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Últimos pagamentos</h2>
            </div>
            <div className="payment-table">
              <div className="payment-row head">
                <span>ID</span><span>Plano</span><span>Valor</span><span>Status</span><span>Criado</span><span>Aprovado</span>
              </div>
              {pagamentos.slice(0, 12).map((p) => (
                <div className="payment-row" key={p.id}>
                  <span>{p.mercado_pago_id}</span>
                  <span>{p.plano_nome}</span>
                  <span>{moeda(p.valor)}</span>
                  <span className={p.status === "approved" ? "badge ok" : "badge wait"}>{p.status}</span>
                  <span>{dataBR(p.criado_em)}</span>
                  <span>{dataBR(p.aprovado_em)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="admin-grid bottom">
            <div className="panel">
              <h2>Solicitações de liberação</h2>
              {solicitacoes.length === 0 && <p>Nenhuma solicitação.</p>}
              {solicitacoes.slice(0, 6).map((s) => (
                <div className="request-card" key={s.id}>
                  <div>
                    <strong>#{s.id} - {s.status}</strong>
                    <span>Pagamento: {s.pagamento_id}</span>
                    <span>Plano: {s.plano_id}</span>
                  </div>
                  <button onClick={() => marcarSolicitacaoLiberada(s.id)}>Marcar liberada</button>
                </div>
              ))}
            </div>

            <div className="panel">
              <h2>Configurações rápidas</h2>
              <label>Disponibilidade do ponto</label>
              <input
                type="datetime-local"
                value={config.fimPermanencia || ""}
                onChange={(e) => setConfig({ ...config, fimPermanencia: e.target.value })}
              />

              <div className="plan-toggle">
                {planosBase.map((plano) => (
                  <label key={plano.id}>
                    <input
                      type="checkbox"
                      checked={config.planosAtivos?.includes(plano.id)}
                      onChange={(e) => {
                        const ativos = new Set(config.planosAtivos || []);
                        e.target.checked ? ativos.add(plano.id) : ativos.delete(plano.id);
                        setConfig({ ...config, planosAtivos: [...ativos] });
                      }}
                    />
                    {plano.nome} - {moeda(plano.preco)}
                  </label>
                ))}
              </div>

              <button className="save" onClick={salvarAdmin}>Salvar configurações</button>
            </div>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="client-shell">
      <section className="client-hero">
        <div className="client-logo">CN <span>WiFi</span></div>
        <h1>Internet rápida no caminhão</h1>
        <p>Escolha um plano, pague no PIX e navegue em segundos.</p>
      </section>

      {config.fimPermanencia && (
        <section className="client-card warning">
          Disponível até <strong>{dataBR(config.fimPermanencia)}</strong>
        </section>
      )}

      {mensagem && <section className="client-card message">{mensagem}</section>}

      {!pagamento && (
        <section className="client-plans">
          {planosDisponiveis.map((plano) => (
            <button key={plano.id} disabled={carregando} onClick={() => comprarPlano(plano)}>
              <span>{plano.nome}</span>
              <strong>{moeda(plano.preco)}</strong>
            </button>
          ))}
        </section>
      )}

      {carregando && <section className="client-card">Processando...</section>}

      {pagamento && (
        <section className="client-card pix-card">
          <h2>Pagamento PIX</h2>
          <p>Plano: <strong>{pagamento.plano.nome}</strong></p>
          <p>Status: <strong>{pagamento.status}</strong></p>
          <p>Valor: <strong>{moeda(pagamento.plano.preco)}</strong></p>

          {pagamento.status !== "approved" && (
            <>
              <img src={`data:image/png;base64,${pagamento.qrCodeBase64}`} alt="QR Code PIX" />
              <textarea readOnly value={pagamento.qrCode} />
              <button onClick={() => navigator.clipboard.writeText(pagamento.qrCode)}>Copiar PIX</button>
              <button onClick={verificarPagamento}>Verificar pagamento</button>
              <button onClick={solicitarLiberacao}>Já paguei, solicitar liberação</button>
            </>
          )}

          {pagamento.status === "approved" && (
            <button onClick={liberarInternetMikrotik}>Liberar internet agora</button>
          )}
        </section>
      )}
    </main>
  );
}

export default App;
