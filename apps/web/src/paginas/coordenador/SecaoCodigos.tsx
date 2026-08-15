import { useEffect, useState } from 'react';
import { apiGet, apiPut, type ErroApi } from '../../api';
import { ROTULO_PAPEL } from '@tcc/compartilhado';

// Seção do Planejamento: senhas/códigos que cada perfil usa para se cadastrar.
const PAPEIS = ['ALUNO', 'PROFESSOR', 'AVALIADOR'] as const;

export function SecaoCodigos() {
  const [codigos, setCodigos] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState('');

  useEffect(() => {
    apiGet('/codigos-cadastro')
      .then((lista: any) => {
        const c: Record<string, string> = {};
        (lista ?? []).forEach((x: any) => (c[x.papel] = x.codigo));
        setCodigos(c);
      })
      .catch(() => {});
  }, []);

  async function salvar() {
    setSalvando(true);
    setMensagem('');
    try {
      // Manda SEMPRE os três papéis: um campo esvaziado precisa chegar como vazio para o
      // backend remover o código (senão a chave sumiria do corpo e nada mudaria).
      const corpo = Object.fromEntries(PAPEIS.map((p) => [p, (codigos[p] ?? '').trim()]));
      const lista: any = await apiPut('/codigos-cadastro', corpo);
      const atualizados: Record<string, string> = {};
      (lista ?? []).forEach((x: any) => (atualizados[x.papel] = x.codigo));
      setCodigos(atualizados);
      setMensagem('Códigos salvos com sucesso.');
    } catch (e) {
      setMensagem((e as ErroApi).mensagem || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="cartao-secao bloco">
      <h2>Códigos de cadastro</h2>
      <p className="legenda" style={{ marginBottom: 18 }}>
        Senha que cada perfil usa para se cadastrar no sistema. Deixe em branco para liberar o
        cadastro daquele perfil sem código.
      </p>
      <div className="grade-3">
        {PAPEIS.map((p) => {
          const exige = (codigos[p] ?? '').trim() !== '';
          return (
            <label key={p} className="campo">
              <span>{ROTULO_PAPEL[p]}</span>
              <input
                value={codigos[p] ?? ''}
                onChange={(e) => setCodigos((c) => ({ ...c, [p]: e.target.value }))}
                placeholder="Sem código (cadastro livre)"
              />
              <small className="legenda">
                {exige ? 'Código obrigatório neste cadastro.' : 'Cadastro liberado sem código.'}
              </small>
            </label>
          );
        })}
      </div>
      <div className="acoes">
        {mensagem && <span className="nota-vazio" style={{ margin: 0, alignSelf: 'center' }}>{mensagem}</span>}
        <button className="botao" disabled={salvando} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Salvar códigos'}
        </button>
      </div>
    </section>
  );
}
