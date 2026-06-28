import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiGet, apiPut } from '../api';

type Notificacao = {
  id: string;
  evento: string;
  titulo: string;
  mensagem: string;
  link: string | null;
  lida: boolean;
  criadoEm: string;
};

const icoSino = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

// dd/MM HH:mm no fuso LOCAL do navegador (a ISO é UTC; o Date converte para o local
// — em Fortaleza/Brasil mostra o horário certo, sem somar/subtrair 3h na mão).
function fmt(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
}

export function Sino() {
  const navegar = useNavigate();
  const location = useLocation();
  const [aberto, setAberto] = useState(false);
  const [itens, setItens] = useState<Notificacao[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  function carregarContador() {
    apiGet<{ total: number }>('/notificacoes/nao-lidas').then((r) => setNaoLidas(r?.total ?? 0)).catch(() => {});
  }
  function carregarLista() {
    apiGet<Notificacao[]>('/notificacoes').then((r) => setItens(r ?? [])).catch(() => setItens([]));
  }

  // Contador no carregamento + polling discreto (60s).
  useEffect(() => {
    carregarContador();
    const t = setInterval(carregarContador, 60000);
    return () => clearInterval(t);
  }, []);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  function alternar() {
    const novo = !aberto;
    setAberto(novo);
    if (novo) carregarLista(); // refetch ao abrir
  }

  async function abrirNotificacao(n: Notificacao) {
    setAberto(false);
    if (!n.lida) {
      setItens((xs) => xs.map((x) => (x.id === n.id ? { ...x, lida: true } : x)));
      setNaoLidas((c) => Math.max(0, c - 1));
      apiPut(`/notificacoes/${n.id}/lida`, {}).catch(() => {});
    }
    if (n.link) {
      // Se já está na página de destino, navegar não recarrega os dados — força um
      // reload completo na URL do link; senão, navegação normal (SPA).
      const destino = n.link.split('#')[0].split('?')[0];
      if (destino === location.pathname) window.location.assign(n.link);
      else navegar(n.link);
    }
  }

  async function marcarTodas() {
    setItens((xs) => xs.map((x) => ({ ...x, lida: true })));
    setNaoLidas(0);
    apiPut('/notificacoes/lidas', {}).catch(() => {});
  }

  return (
    <div className="sino" ref={ref}>
      <button className="sino-gatilho" onClick={alternar} aria-label="Notificações" aria-expanded={aberto}>
        {icoSino}
        {naoLidas > 0 && <span className="sino-badge">{naoLidas > 99 ? '99+' : naoLidas}</span>}
      </button>

      {aberto && (
        <div className="sino-menu" role="menu">
          <div className="sino-cabecalho">
            <strong>Notificações</strong>
            {itens.some((x) => !x.lida) && (
              <button className="link-inline" onClick={marcarTodas}>Marcar todas como lidas</button>
            )}
          </div>
          {itens.length === 0 ? (
            <p className="sino-vazio">Você não tem notificações.</p>
          ) : (
            <div className="sino-lista">
              {itens.map((n) => (
                <button key={n.id} className={`sino-item${n.lida ? '' : ' nao-lida'}`} onClick={() => abrirNotificacao(n)}>
                  <span className="sino-ponto" aria-hidden />
                  <span className="sino-item-texto">
                    <span className="sino-item-titulo">{n.titulo}</span>
                    <span className="sino-item-msg">{n.mensagem}</span>
                    <span className="sino-item-data">{fmt(n.criadoEm)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
