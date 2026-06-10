import { useEffect, useState } from 'react';
import { apiGet, apiPut, type ErroApi } from '../../api';
import { MARCOS_CALENDARIO, ROTULO_MARCO, DESC_MARCO, type MarcoCalendario } from '@tcc/compartilhado';

function paraInput(valor: string | null | undefined): string {
  if (!valor) return '';
  return new Date(valor).toISOString().slice(0, 10);
}

// Seção do Planejamento: calendário do semestre (datas-marco).
export function SecaoCalendario() {
  const [datas, setDatas] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState('');

  useEffect(() => {
    apiGet('/calendario')
      .then((cal: any) => {
        if (cal) {
          const d: Record<string, string> = {};
          for (const m of MARCOS_CALENDARIO) d[m] = paraInput(cal[m]);
          setDatas(d);
        }
      })
      .catch(() => {});
  }, []);

  function mudar(marco: MarcoCalendario, valor: string) {
    setDatas((d) => ({ ...d, [marco]: valor }));
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
    <section className="cartao-secao bloco">
      <h2>Calendário do semestre</h2>
      <p className="legenda" style={{ marginBottom: 18 }}>
        Defina as datas-marco. Elas aparecem na aba “Informações” dos alunos.
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
  );
}
