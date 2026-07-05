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

  async function carregarConfig() {
    const { data } = await axios.get(`${API_URL}/api/config`);
    setConfig(data);
  }

  useEffect(() => {
    carregarConfig();
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

      setMensagem("PIX gerado. Faça o pagamento para liberar o acesso.");

      setTimeout(() => {
        document.querySelector(".pagamento")?.scrollIntoView({ behavior: "smooth" });
      }, 200);
    } catch (error) {
      alert(
        JSON.stringify(
          error.response?.data || { erro: error.message },
          null,
          2
        )
      );
      console.error("ERRO PIX:", error);
    } finally {
      setCarregando(false);
    }
  }

  async function simularLiberacao() {
    try {
      setCarregando(true);
      setMensagem("Verificando pagamento...");

      const { data } = await axios.get(`${API_URL}/api/pagamentos/${pagamento.pagamentoId}/status`);

      if (!data.aprovado) {
        setMensagem("Pagamento ainda não aprovado. Aguarde alguns segundos e tente novamente.");
        return;
      }

      setPagamento({
        ...pagamento,
        status: "approved",
        voucher: data.voucher || "LIBERADO",
      });

      setMensagem("Pagamento aprovado. Liberando internet...");

      const form = document.createElement("form");
      form.method = "POST";
      form.action = "http://login.cnwifi.local/login";

      const user = document.createElement("input");
      user.name = "username";
      user.value = "cnwifi";

      const pass = document.createElement("input");
      pass.name = "password";
      pass.value = "2529";

      form.appendChild(user);
      form.appendChild(pass);
      document.body.appendChild(form);
      form.submit();
    } catch (error) {
      alert(error.response?.data?.erro || error.message || "Erro ao liberar acesso.");
    } finally {
      setCarregando(false);
    }
  }

  async function salvarAdmin() {
    await axios.put(`${API_URL}/api/config`, config);
    alert("Configuração salva.");
    carregarConfig();
  }

  async function carregarClientes() {
    const { data } = await axios.get(`${API_URL}/api/admin/clientes`);
    setClientes(data.clientes || []);
  }

  async function desconectarCliente(mac) {
    await axios.post(`${API_URL}/api/admin/clientes/desconectar`, { mac });
    await carregarClientes();
  }

  async function limparClientes() {
    if (!confirm("Desconectar todos os clientes?")) return;
    await axios.post(`${API_URL}/api/admin/clientes/limpar`);
    await carregarClientes();
  }

  async function solicitarLiberacao() {
    if (!pagamento?.pagamentoId) {
      alert("Gere um pagamento primeiro.");
      return;
    }

    await axios.post(`${API_URL}/api/solicitacoes-liberacao`, {
      pagamentoId: pagamento.pagamentoId,
      planoId: pagamento.plano?.id,
      observacao: "Cliente informou que já pagou e pediu liberação."
    });

    alert("Solicitação enviada. Aguarde a liberação.");
  }

  async function carregarSolicitacoes() {
    const { data } = await axios.get(`${API_URL}/api/admin/solicitacoes-liberacao`);
    setSolicitacoes(data.solicitacoes || []);
  }

  async function marcarSolicitacaoLiberada(id) {
    await axios.post(`${API_URL}/api/admin/solicitacoes-liberacao/${id}/marcar-liberada`);
    await carregarSolicitacoes();
  }

  if (!config) return <main className="container">Carregando...</main>;

  if (isAdmin) {
    if (!logado) {
      return (
        <main className="container">
          <section className="card hero">
            <h1>Admin CN WiFi</h1>
            <p>Digite a senha do administrador.</p>
            <input
              type="password"
              placeholder="Senha"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
            <button
              className="confirmar"
              onClick={() => {
                if (senha === config.senhaAdmin) setLogado(true);
                else alert("Senha incorreta.");
              }}
            >
              Entrar
            </button>
          </section>
        </main>
      );
    }

    return (
      <main className="container">
        <section className="card hero">
          <h1>Admin CN WiFi</h1>
          <p>Controle do ponto de internet.</p>
        </section>

        <section className="card aviso">
          <h2>Disponibilidade do ponto</h2>
          <label>Até quando você ficará neste local?</label>
          <input
            type="datetime-local"
            value={config.fimPermanencia || ""}
            onChange={(e) =>
              setConfig({ ...config, fimPermanencia: e.target.value })
            }
          />
        </section>

        <section className="card aviso">
          <h2>Planos ativos</h2>
          {planosBase.map((plano) => (
            <label key={plano.id} style={{ display: "block", margin: "10px 0" }}>
              <input
                type="checkbox"
                checked={config.planosAtivos?.includes(plano.id)}
                onChange={(e) => {
                  const ativos = new Set(config.planosAtivos || []);
                  e.target.checked ? ativos.add(plano.id) : ativos.delete(plano.id);
                  setConfig({ ...config, planosAtivos: [...ativos] });
                }}
              />{" "}
              {plano.nome} -{" "}
              {plano.preco.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}
            </label>
          ))}

          <button className="confirmar" onClick={salvarAdmin}>
            Salvar configurações
          </button>
        </section>

        <section className="card aviso">
          <h2>Clientes conectados</h2>

          <button className="confirmar" onClick={carregarClientes}>
            Atualizar clientes
          </button>

          <button className="confirmar" onClick={carregarSolicitacoes}>
            Ver solicitações de liberação
          </button>

          {solicitacoes.map((sol) => (
            <div
              key={sol.id}
              style={{
                marginTop: 12,
                padding: 12,
                border: "1px solid #243044",
                borderRadius: 12,
                textAlign: "left"
              }}
            >
              <p><strong>Solicitação:</strong> #{sol.id}</p>
              <p><strong>Pagamento:</strong> {sol.pagamento_id}</p>
              <p><strong>Plano:</strong> {sol.plano_id}</p>
              <p><strong>Status:</strong> {sol.status}</p>
              <p><strong>Data:</strong> {new Date(sol.criado_em).toLocaleString("pt-BR")}</p>

              <button
                className="confirmar"
                onClick={() => marcarSolicitacaoLiberada(sol.id)}
              >
                Marcar como liberada
              </button>
            </div>
          ))}

          <button className="confirmar" onClick={limparClientes}>
            Desconectar todos
          </button>

          {clientes.length === 0 && (
            <p>Nenhum cliente conectado.</p>
          )}

          {clientes.map((cliente) => (
            <div
              key={cliente.mac}
              style={{
                marginTop: 12,
                padding: 12,
                border: "1px solid #243044",
                borderRadius: 12,
                textAlign: "left"
              }}
            >
              <p><strong>IP:</strong> {cliente.ip}</p>
              <p><strong>MAC:</strong> {cliente.mac}</p>
              <p><strong>Status:</strong> {cliente.state}</p>
              <p><strong>Início:</strong> {cliente.sessionStart}</p>
              <p><strong>Fim:</strong> {cliente.sessionEnd}</p>
              <p><strong>Download:</strong> {cliente.download}</p>
              <p><strong>Upload:</strong> {cliente.upload}</p>

              <button
                className="confirmar"
                onClick={() => desconectarCliente(cliente.mac)}
              >
                Expulsar cliente
              </button>
            </div>
          ))}
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="card hero">
        <h1>CN WiFi</h1>
        <p>Internet temporária rápida, simples e segura.</p>
      </section>

      {config.fimPermanencia && (
        <section className="card aviso">
          <h2>Disponibilidade</h2>
          <p>
            Este ponto ficará disponível até{" "}
            <strong>{new Date(config.fimPermanencia).toLocaleString("pt-BR")}</strong>.
          </p>
        </section>
      )}

      <section className="planos">
        {planosDisponiveis.map((plano) => (
          <button
            key={plano.id}
            className="plano"
            disabled={carregando}
            onClick={() => comprarPlano(plano)}
          >
            <span>{plano.nome}</span>
            <strong>
              {plano.preco.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}
            </strong>
          </button>
        ))}
      </section>

      {carregando && <section className="card pagamento">Processando...</section>}

      {pagamento && (
        <section className="card pagamento">
          <h2>Pagamento PIX</h2>
          <p>Plano: {pagamento.plano.nome}</p>
          <p>Status: <strong>{pagamento.status}</strong></p>
          <p>
            Valor:{" "}
            <strong>
              {pagamento.plano.preco.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}
            </strong>
          </p>

          {pagamento.status !== "approved" && (
            <>
              <img
                className="qr"
                src={`data:image/png;base64,${pagamento.qrCodeBase64}`}
                alt="QR Code PIX"
              />

              <textarea readOnly value={pagamento.qrCode} />

              <button
                className="confirmar"
                onClick={() => navigator.clipboard.writeText(pagamento.qrCode)}
              >
                Copiar PIX
              </button>

              <button className="confirmar" onClick={simularLiberacao}>
                Verificar pagamento e liberar internet
              </button>

              <button className="confirmar" onClick={solicitarLiberacao}>
                Já paguei, solicitar liberação
              </button>
            </>
          )}

          {mensagem && <p><strong>{mensagem}</strong></p>}
        </section>
      )}
    </main>
  );
}

export default App;
