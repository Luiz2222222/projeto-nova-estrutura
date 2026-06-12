import { useEffect, useState } from 'react';
import { apiGet, apiPut, type ErroApi } from '../../api';
import { CRITERIOS_FASE1, CRITERIOS_FASE2, colunaPeso, soma, pesosSomam10, type Criterio } from '@tcc/compartilhado';

// Seção do Planejamento: pesos por critério das avaliações (cada fase soma 10).
export function SecaoPesos() {
  const [valores, setValores] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState('');

  const TODOS = [...CRITERIOS_FASE1, ...CRITERIOS_FASE2];

  useEffect(() => {
    apiGet('/calendario')
      .then((cal: any) => {
        const v: Record<string, string> = {};
        TODOS.forEach((c) => (v[c.chave] = String(cal?.[colunaPeso(c.chave)] ?? c.pesoPadrao)));
        setValores(v);
      })
      .catch(() => {
        const v: Record<string, string> = {};
        TODOS.forEach((c) => (v[c.chave] = String(c.pesoPadrao)));
        setValores(v);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const num = (chave: string) => {
    const n = parseFloat((valores[chave] ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  const somaFase = (cs: Criterio[]) => soma(cs.map((c) => num(c.chave)));
  const podeSalvar = pesosSomam10(CRITERIOS_FASE1.map((c) => num(c.chave))) && pesosSomam10(CRITERIOS_FASE2.map((c) => num(c.chave)));

  async function salvar() {
    setMensagem('');
    setSalvando(true);
    try {
      const corpo: Record<string, number> = {};
      TODOS.forEach((c) => (corpo[colunaPeso(c.chave)] = num(c.chave)));
      await apiPut('/calendario/pesos', corpo);
      setMensagem('Pesos salvos com sucesso.');
    } catch (e) {
      setMensagem((e as ErroApi).mensagem || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  const grupo = (titulo: string, criterios: Criterio[]) => {
    const s = somaFase(criterios);
    return (
      <div>
        <div className="cabecalho-secao" style={{ marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>{titulo}</h3>
          <span className={`pilula ${Math.abs(s - 10) < 0.01 ? 'pilula-ok' : 'pilula-bad'}`}>
            Soma: {s.toFixed(1).replace('.', ',')} / 10
          </span>
        </div>
        <div className="pesos-grid">
          {criterios.map((c) => (
            <label key={c.chave} className="campo">
              <span>{c.rotulo}</span>
              <input
                inputMode="decimal"
                value={valores[c.chave] ?? ''}
                onChange={(e) => setValores((v) => ({ ...v, [c.chave]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      </div>
    );
  };

  return (
    <section className="cartao-secao bloco">
      <h2>Pesos das notas</h2>
      <p className="legenda" style={{ marginBottom: 18 }}>
        Peso de cada critério usado nas avaliações da banca. Cada fase deve somar 10.
      </p>
      {grupo('Fase I — Monografia', CRITERIOS_FASE1)}
      <div style={{ height: 18 }} />
      {grupo('Fase II — Apresentação', CRITERIOS_FASE2)}
      <div className="acoes">
        {mensagem && <span className="nota-vazio" style={{ margin: 0, alignSelf: 'center' }}>{mensagem}</span>}
        <button className="botao" disabled={salvando || !podeSalvar} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Salvar pesos'}
        </button>
      </div>
    </section>
  );
}
