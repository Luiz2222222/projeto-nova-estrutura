// Quem recebe cada aviso. Três regras que já valiam e não podem regredir com a revisão dos
// textos, mais a do coorientador externo — que NÃO tem conta e por isso não recebe nada.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { EventosTccService } from './eventos-tcc.service';

const ler = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const TCCS = ler('tccs/tccs.service.ts');
const BANCAS = ler('bancas/bancas.service.ts');

describe('Coorientador EXTERNO não recebe evento', () => {
  // Externo é só texto no TCC (coorientadorNome/Titulacao/Afiliacao). Só quem tem conta
  // vinculada em coorientadorId entra nos avisos.
  it('todo disparo de coorientação usa coorientadorId, nunca o nome textual', () => {
    const disparos = [...TCCS.matchAll(/emitirParaUsuario\(\s*'coorientador_[a-z_]+',\s*([^,]+),/g)].map((m) => m[1].trim());

    expect(disparos.length).toBeGreaterThan(0);
    for (const alvo of disparos) expect(alvo).toBe('tcc.coorientadorId');
  });

  it('emitirParaUsuario sem id sai sem tocar em e-mail nem notificação', async () => {
    const prisma = { usuario: { findUnique: vi.fn() } } as any;
    const email = { enviarEvento: vi.fn() } as any;
    const notificacoes = { criar: vi.fn() } as any;

    await new EventosTccService(prisma, email, notificacoes).emitirParaUsuario('coorientador_indicado', null, 'T', 'M');

    expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
    expect(email.enviarEvento).not.toHaveBeenCalled();
    expect(notificacoes.criar).not.toHaveBeenCalled();
  });

  it('coorientador externo (só nome no TCC) deixa coorientadorId nulo', async () => {
    // Espelha o caso real: TCC com coorientadorNome preenchido e coorientadorId nulo.
    const tcc = { coorientadorId: null, coorientadorNome: 'Prof. Externo da Silva' };
    const prisma = { usuario: { findUnique: vi.fn() } } as any;
    const notificacoes = { criar: vi.fn() } as any;

    await new EventosTccService(prisma, { enviarEvento: vi.fn() } as any, notificacoes).emitirParaUsuario(
      'coorientador_documentos',
      tcc.coorientadorId,
      'T',
      'M',
    );

    expect(notificacoes.criar).not.toHaveBeenCalled();
  });
});

describe('Sem aviso dobrado para a coordenação (4.2 x 4.7)', () => {
  it('"Continuidade confirmada" só sai quando NÃO houve "Formar banca"', () => {
    // O disparo de coord_continuidade mora no ELSE de `if (vaiPraBanca)` — nunca no mesmo
    // ramo do "formar banca", senão a coordenação receberia os dois avisos de uma vez.
    const inicio = TCCS.indexOf('const vaiPraBanca = resultado.vaiPraBanca;');
    const bloco = TCCS.slice(inicio, inicio + 2500);

    const formar = bloco.indexOf('coord_formar_banca_fase1');
    const continuidade = bloco.indexOf("'coord_continuidade', 'Continuidade confirmada'");
    const senao = bloco.indexOf('} else {');

    expect(formar).toBeGreaterThan(-1);
    expect(continuidade).toBeGreaterThan(-1);
    expect(senao).toBeGreaterThan(-1);
    // "formar banca" no ramo do if; "continuidade" depois do else — nunca os dois juntos.
    expect(formar).toBeLessThan(senao);
    expect(continuidade).toBeGreaterThan(senao);
  });
});

describe('Sem aviso dobrado para o aluno (11.3)', () => {
  it('"Fase validada" genérico vai só para orientador e banca', () => {
    const inicio = BANCAS.indexOf('private async notificarFaseValidada');
    const bloco = BANCAS.slice(inicio, BANCAS.indexOf('private faseFromAguardando'));

    expect(bloco).toContain("emitirParaUsuario('fase_validada'");
    expect(bloco).toContain('if (orientadorId) alvos.add(orientadorId)');
    expect(bloco).not.toContain('alunoId'); // o aluno recebe o resultado específico da fase
  });

  it('os outros dois avisos de fase seguem incluindo o aluno', () => {
    for (const metodo of ['notificarAvaliacoesConcluidas', 'notificarAnaliseIniciada']) {
      const inicio = BANCAS.indexOf(`private async ${metodo}`);
      const bloco = BANCAS.slice(inicio, inicio + 1200);
      expect(bloco).toContain('if (tcc.alunoId) alvos.add(tcc.alunoId)');
    }
  });
});

describe('Preferências de e-mail sem entrada morta', () => {
  const CATALOGO = readFileSync(join(__dirname, '../../../../pacotes/compartilhado/src/index.ts'), 'utf8');

  it('eventos removidos não são mais CHAVE de preferência', () => {
    // Os nomes antigos podem aparecer em comentário explicando a troca; o que não pode é
    // sobrar uma entrada ativa (chave: '...') gerando um interruptor sem e-mail por trás.
    expect(CATALOGO).not.toContain("chave: 'orientador_confirmar_continuidade'");
    expect(CATALOGO).not.toContain("chave: 'avaliador_fase1_liberada'");
    const PREFS = readFileSync(join(__dirname, '../../../web/src/componentes/PreferenciasEmail.tsx'), 'utf8');
    expect(PREFS).not.toContain('orientador_confirmar_continuidade');
    expect(PREFS).not.toContain('avaliador_fase1_liberada');
  });

  it('o lembrete de continuidade tem UMA preferência, não três', () => {
    const ocorrencias = CATALOGO.match(/orientador_lembrete_continuidade/g) ?? [];
    expect(ocorrencias).toHaveLength(1);
  });

  it('todo evento disparado no código existe no catálogo', () => {
    const disparados = new Set(
      [...(TCCS + BANCAS + ler('bancas/defesas.service.ts')).matchAll(/emitirPara(?:Usuario|Coordenadores)\(\s*'([a-z0-9_]+)'/g)].map(
        (m) => m[1],
      ),
    );
    for (const evento of disparados) expect(CATALOGO).toContain(`'${evento}'`);
  });
});
