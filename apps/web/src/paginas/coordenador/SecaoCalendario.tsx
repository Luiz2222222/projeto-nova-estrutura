import { useEffect, useState } from 'react';
import { apiGet, apiPut, type ErroApi } from '../../api';
import { MARCOS_CALENDARIO, ROTULO_MARCO, DESC_MARCO, type MarcoCalendario } from '@tcc/compartilhado';

function paraInput(valor: string | null | undefined): string {
  if (!valor) return '';
  return new Date(valor).toISOString().slice(0, 10);
}

// Seção do Planejamento: período/semestre ATIVO (manual) + calendário desse período.
export function SecaoCalendario() {
  const [datas, setDatas] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState('');

  // Período ativo definido manualmente pela coordenação (o sistema não troca sozinho pela data).
  const [periodoAtivo, setPeriodoAtivo] = useState<string>('');
  const [periodo, setPeriodo] = useState<string>('');
  const [salvandoPeriodo, setSalvandoPeriodo] = useState(false);
  const [msgPeriodo, setMsgPeriodo] = useState('');

  function carregarCalendario() {
    apiGet('/calendario')
      .then((cal: any) => {
        const d: Record<string, string> = {};
        for (const m of MARCOS_CALENDARIO) d[m] = cal ? paraInput(cal[m]) : '';
        setDatas(d);
      })
      .catch(() => {});
  }

  useEffect(() => {
    apiGet('/semestre-ativo')
      .then((r: any) => {
        setPeriodoAtivo(r?.semestre ?? '');
        setPeriodo(r?.semestre ?? '');
      })
      .catch(() => {});
    carregarCalendario();
  }, []);

  function mudar(marco: MarcoCalendario, valor: string) {
    setDatas((d) => ({ ...d, [marco]: valor }));
  }

  async function salvarPeriodo() {
    setSalvandoPeriodo(true);
    setMsgPeriodo('');
    try {
      const r: any = await apiPut('/semestre-ativo', { semestre: periodo.trim() });
      setPeriodoAtivo(r?.semestre ?? periodo.trim());
      setPeriodo(r?.semestre ?? periodo.trim());
      setMsgPeriodo(`Período ativo definido: ${r?.semestre ?? periodo.trim()}.`);
      carregarCalendario(); // o calendário é por período — recarrega o do período ativo
    } catch (e) {
      const er = e as ErroApi;
      setMsgPeriodo(er.erros?.[0]?.mensagem || er.mensagem || 'Não foi possível definir o período.');
    } finally {
      setSalvandoPeriodo(false);
    }
  }

  async function salvar() {
    setSalvando(true);
    setMensagem('');
    try {
      const corpo: Record<string, string | null> = {};
      for (const m of MARCOS_CALENDARIO) corpo[m] = datas[m] || null;
      await apiPut('/calendario', corpo);
      setMensagem('Calendário salvo com sucesso.');
    } catch (e) {
      setMensagem((e as ErroApi).mensagem || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <section className="cartao-secao bloco">
        <h2>Período ativo do sistema</h2>
        <p className="legenda" style={{ marginBottom: 18 }}>
          Defina manualmente o período letivo ativo (ex.: <strong>2026.1</strong>). É ele que o sistema usa
          para listar TCCs, calendário, exportações e pesos. O sistema não troca de período sozinho pela data,
          e mudar o período aqui <strong>não altera</strong> o semestre de TCCs já existentes.
        </p>
        <div className="acoes" style={{ justifyContent: 'flex-start', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="campo" style={{ maxWidth: 200 }}>
            <span>Período ativo</span>
            <input
              type="text"
              value={periodo}
              placeholder="2026.1"
              maxLength={7}
              onChange={(e) => setPeriodo(e.target.value)}
            />
            <small className="muted">Formato: AAAA.1 ou AAAA.2</small>
          </label>
          <button className="botao" disabled={salvandoPeriodo || !periodo.trim() || periodo.trim() === periodoAtivo} onClick={salvarPeriodo}>
            {salvandoPeriodo ? 'Definindo…' : 'Definir período'}
          </button>
          {msgPeriodo && <span className="nota-vazio" style={{ margin: 0, alignSelf: 'center' }}>{msgPeriodo}</span>}
        </div>
      </section>

      <section className="cartao-secao bloco">
        <h2>Calendário do período {periodoAtivo && <span className="muted">({periodoAtivo})</span>}</h2>
        <p className="legenda" style={{ marginBottom: 18 }}>
          Defina as datas-marco do período ativo. Elas aparecem na aba “Informações” dos alunos.
        </p>
        <div className="calendario-grid">
          {MARCOS_CALENDARIO.map((m) => (
            <label key={m} className="campo">
              <span>{ROTULO_MARCO[m]}</span>
              <input type="date" value={datas[m] ?? ''} onChange={(e) => mudar(m, e.target.value)} />
              <small className="muted">{DESC_MARCO[m]}</small>
            </label>
          ))}
        </div>
        <div className="acoes">
          {mensagem && <span className="nota-vazio" style={{ margin: 0, alignSelf: 'center' }}>{mensagem}</span>}
          <button className="botao" disabled={salvando} onClick={salvar}>
            {salvando ? 'Salvando…' : 'Salvar calendário'}
          </button>
        </div>
      </section>
    </>
  );
}
