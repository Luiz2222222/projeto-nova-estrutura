// @vitest-environment jsdom
// Card do Drive no Planejamento: mostra a conta global conectada, pendências, e só deixa
// encerrar o período com prévia OK, senha e a palavra ENCERRAR.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SecaoDrive } from './SecaoDrive';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('../../api', () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  mensagemErro: (e: any, padrao: string) => e?.mensagem || padrao,
  URL_API: '/api',
}));

const statusBase = {
  conectado: true,
  configurado: true,
  contaEmail: 'coordenacaodee@ufpe.br',
  pastaRaizNome: 'Sistema de TCC - DEE',
  conectadoEm: '2026-08-01T12:00:00Z',
  ultimoSyncEm: '2026-08-13T12:00:00Z',
  ultimoErro: null as string | null,
  pendentes: 0,
  comErro: 0,
};

const previaBase = {
  semestre: '2026.2',
  conectadoAoDrive: true,
  tccs: 12,
  pendenciasSincronizacao: 0,
  podeEncerrar: true,
  contasParaApagar: [{ nome: 'Lucas', email: 'lucas@ufpe.br', papel: 'ALUNO' }],
  contasPreservadas: [{ nome: 'Bia', papel: 'PROFESSOR', motivo: 'participa de outro período' }],
};

function responder(status = statusBase, previa: any = previaBase) {
  apiGet.mockImplementation(async (rota: string) => (rota === '/drive/status' ? status : previa));
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
});

describe('Status da integração', () => {
  it('mostra a conta autorizada e o último sync', async () => {
    responder();
    render(<SecaoDrive />);
    expect(await screen.findByDisplayValue('coordenacaodee@ufpe.br')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Conectado')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Sistema de TCC - DEE')).toBeInTheDocument();
  });

  it('avisa quando o servidor não tem as credenciais configuradas', async () => {
    responder({ ...statusBase, configurado: false, conectado: false });
    render(<SecaoDrive />);
    expect(await screen.findByText(/não configurada no servidor/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Conectar conta/i })).not.toBeInTheDocument();
  });

  // O encerramento é garantido pelo arquivo local: não pode sumir junto com a integração.
  it('SEM integração configurada, o encerramento continua visível e utilizável', async () => {
    responder({ ...statusBase, configurado: false, conectado: false });
    render(<SecaoDrive />);

    expect(await screen.findByRole('heading', { name: 'Encerrar e arquivar período' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ver impacto do encerramento/i })).toBeEnabled();
  });

  it('SEM integração, dá para abrir a prévia e chegar ao botão de encerrar', async () => {
    responder({ ...statusBase, configurado: false, conectado: false }, { ...previaBase, conectadoAoDrive: false });
    render(<SecaoDrive />);
    fireEvent.click(await screen.findByRole('button', { name: /Ver impacto do encerramento/i }));

    await screen.findByText(/Contas que serão apagadas/i);
    fireEvent.change(screen.getByLabelText('Sua senha'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Digite ENCERRAR para confirmar'), { target: { value: 'ENCERRAR' } });
    expect(screen.getByRole('button', { name: /Encerrar e arquivar período/i })).toBeEnabled();
  });

  it('desconectado oferece conectar; conectado oferece tentar novamente e desconectar', async () => {
    responder({ ...statusBase, conectado: false });
    const { unmount } = render(<SecaoDrive />);
    expect(await screen.findByRole('button', { name: /Conectar conta do Google/i })).toBeInTheDocument();
    unmount();

    responder();
    render(<SecaoDrive />);
    expect(await screen.findByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desconectar' })).toBeInTheDocument();
  });

  it('mostra as pendências da fila', async () => {
    responder({ ...statusBase, pendentes: 3, comErro: 2, ultimoErro: 'quota excedida' });
    render(<SecaoDrive />);
    expect(await screen.findByText(/quota excedida/)).toBeInTheDocument();
  });
});

describe('Encerramento de período', () => {
  async function abrirPrevia(previa: any = previaBase) {
    responder(statusBase, previa);
    render(<SecaoDrive />);
    fireEvent.click(await screen.findByRole('button', { name: /Ver impacto do encerramento/i }));
    await screen.findByText(/Contas que serão apagadas/i);
  }

  it('mostra o impacto antes de qualquer ação', async () => {
    await abrirPrevia();
    expect(screen.getByText(/12 TCC\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/Lucas \(ALUNO\)/)).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled(); // a prévia não muda nada
  });

  it('botão fica travado sem senha e sem a palavra ENCERRAR', async () => {
    await abrirPrevia();
    const botao = screen.getByRole('button', { name: /Encerrar e arquivar período/i });
    expect(botao).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Sua senha'), { target: { value: 'minha-senha' } });
    expect(botao).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Digite ENCERRAR para confirmar'), { target: { value: 'APAGAR' } });
    expect(botao).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Digite ENCERRAR para confirmar'), { target: { value: 'ENCERRAR' } });
    expect(botao).toBeEnabled();
  });

  // O Drive deixou de ser pré-requisito, e a prévia avisa que depois não há como enviar.
  it('sem Drive conectado, avisa que só a VPS guarda — e AINDA permite encerrar', async () => {
    await abrirPrevia({ ...previaBase, conectadoAoDrive: false, pendenciasSincronizacao: 4 });
    fireEvent.change(screen.getByLabelText('Sua senha'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Digite ENCERRAR para confirmar'), { target: { value: 'ENCERRAR' } });

    // O texto é quebrado por <strong>, então casamos trechos contíguos.
    expect(screen.getByText(/Google Drive não conectado/i)).toBeInTheDocument();
    expect(screen.getByText(/não há como enviar estes TCCs ao Drive/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Encerrar e arquivar período/i })).toBeEnabled();
  });

  it('explica que nada é apagado sem o arquivo local validado', async () => {
    await abrirPrevia();
    expect(screen.getByText(/arquivo permanente da VPS antes de qualquer exclusão/i)).toBeInTheDocument();
  });

  it('sem TCC no período, o botão fica bloqueado', async () => {
    await abrirPrevia({ ...previaBase, tccs: 0, podeEncerrar: false });
    fireEvent.change(screen.getByLabelText('Sua senha'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Digite ENCERRAR para confirmar'), { target: { value: 'ENCERRAR' } });
    expect(screen.getByRole('button', { name: /Encerrar e arquivar período/i })).toBeDisabled();
    expect(screen.getByText(/Não há TCC neste período/i)).toBeInTheDocument();
  });

  const relatorio = (over: Record<string, unknown> = {}) => ({
    semestre: '2026.2',
    tccsArquivados: 12,
    tccsApagados: 12,
    arquivosLocaisRemovidos: 40,
    contasApagadas: ['Lucas'],
    contasPreservadas: [],
    arquivadoLocalmente: true,
    driveConectado: true,
    copiadoParaDrive: 12,
    ...over,
  });

  it('confirmado, envia senha e confirmação e informa o arquivamento local', async () => {
    apiPost.mockResolvedValue(relatorio());
    await abrirPrevia();
    fireEvent.change(screen.getByLabelText('Sua senha'), { target: { value: 'minha-senha' } });
    fireEvent.change(screen.getByLabelText('Digite ENCERRAR para confirmar'), { target: { value: 'ENCERRAR' } });
    fireEvent.click(screen.getByRole('button', { name: /Encerrar e arquivar período/i }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/periodo/encerrar', { senha: 'minha-senha', confirmacao: 'ENCERRAR' }));
    expect(await screen.findByText(/Período 2026.2 arquivado localmente/i)).toBeInTheDocument();
  });

  // Nada de prometer "cópia pendente": não existe fila que reenvie ao Drive depois.
  it('sem Drive, o relatório diz que NÃO houve cópia — sem prometer pendência', async () => {
    apiPost.mockResolvedValue(relatorio({ driveConectado: false, copiadoParaDrive: 0 }));
    await abrirPrevia({ ...previaBase, conectadoAoDrive: false });
    fireEvent.change(screen.getByLabelText('Sua senha'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Digite ENCERRAR para confirmar'), { target: { value: 'ENCERRAR' } });
    fireEvent.click(screen.getByRole('button', { name: /Encerrar e arquivar período/i }));

    expect(await screen.findByText(/arquivado localmente/i)).toBeInTheDocument();
    expect(screen.getByText(/Sem cópia no Google Drive/i)).toBeInTheDocument();
    expect(screen.getByText(/arquivo permanente da VPS está completo/i)).toBeInTheDocument();
    expect(screen.queryByText(/pendente/i)).not.toBeInTheDocument();
  });

  it('com Drive conectado, o relatório informa quantos foram copiados', async () => {
    apiPost.mockResolvedValue(relatorio({ driveConectado: true, copiadoParaDrive: 12 }));
    await abrirPrevia();
    fireEvent.change(screen.getByLabelText('Sua senha'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Digite ENCERRAR para confirmar'), { target: { value: 'ENCERRAR' } });
    fireEvent.click(screen.getByRole('button', { name: /Encerrar e arquivar período/i }));

    expect(await screen.findByText(/Cópia adicional enviada ao Google Drive para 12 TCC/i)).toBeInTheDocument();
  });
});
