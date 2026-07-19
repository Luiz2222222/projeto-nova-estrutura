import { useEffect, useId, useRef, useState } from 'react';
import { contemBusca } from '../utils/texto';
import type { UsuarioResumo } from '../tipos';

// Combobox de avaliador SEM dependência nova: digitar no próprio campo FILTRA os
// candidatos (sem diferenciar caixa/acentos); digitar NUNCA seleciona sozinho — só
// confirmar uma opção (clique ou Enter) escolhe o avaliador. Acessível: papel
// combobox/listbox, navegação por setas, Enter confirma, Esc fecha.
export function ComboAvaliador({
  rotulo,
  valor,
  candidatos,
  rotuloDe,
  excluirId,
  aoEscolher,
}: {
  rotulo: string;
  valor: string; // id selecionado ('' = nenhum)
  candidatos: UsuarioResumo[];
  rotuloDe: (c: UsuarioResumo) => string;
  excluirId?: string; // pessoa já escolhida no OUTRO campo (não pode repetir)
  aoEscolher: (id: string) => void;
}) {
  const idLista = useId();
  const selecionado = candidatos.find((c) => c.id === valor) ?? null;
  const [texto, setTexto] = useState(selecionado ? rotuloDe(selecionado) : '');
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(-1); // índice destacado pelo teclado
  const raiz = useRef<HTMLDivElement>(null);

  // Se a seleção mudar por fora (ex.: limpeza pelo outro campo), sincroniza o texto.
  useEffect(() => {
    setTexto(selecionado ? rotuloDe(selecionado) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);

  const opcoes = candidatos
    .filter((c) => c.id !== excluirId)
    .filter((c) => !texto.trim() || c.id === valor || contemBusca(rotuloDe(c), texto));

  function escolher(c: UsuarioResumo) {
    aoEscolher(c.id);
    setTexto(rotuloDe(c));
    setAberto(false);
    setAtivo(-1);
  }

  function aoDigitar(v: string) {
    setTexto(v);
    setAberto(true);
    setAtivo(-1);
    if (valor) aoEscolher(''); // digitar não seleciona: desfaz até confirmar numa opção
  }

  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAberto(true);
      setAtivo((i) => Math.min(i + 1, opcoes.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (aberto && ativo >= 0 && opcoes[ativo]) {
        e.preventDefault();
        escolher(opcoes[ativo]);
      }
    } else if (e.key === 'Escape') {
      setAberto(false);
      setAtivo(-1);
    }
  }

  // Fecha ao clicar fora (sem perder a seleção confirmada).
  useEffect(() => {
    const f = (ev: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(ev.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, []);

  return (
    <div className="campo combo-avaliador" ref={raiz}>
      <span>{rotulo}</span>
      <input
        role="combobox"
        aria-expanded={aberto}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-label={rotulo}
        value={texto}
        placeholder="Digite para filtrar…"
        onChange={(e) => aoDigitar(e.target.value)}
        onFocus={() => setAberto(true)}
        onKeyDown={aoTeclar}
      />
      {aberto && (
        <ul id={idLista} role="listbox" className="combo-lista">
          {opcoes.length === 0 ? (
            <li className="combo-vazio" aria-disabled="true">Nenhum candidato encontrado.</li>
          ) : (
            opcoes.map((c, i) => (
              <li
                key={c.id}
                role="option"
                aria-selected={c.id === valor}
                className={`combo-opcao${i === ativo ? ' ativa' : ''}${c.id === valor ? ' sel' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault(); // não rouba o foco do input
                  escolher(c);
                }}
              >
                {rotuloDe(c)}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
