import { SetMetadata } from '@nestjs/common';

export const PAPEIS_CHAVE = 'papeis';

// Marca quais papéis podem acessar a rota. Ex.: @Papeis('COORDENADOR')
export const Papeis = (...papeis: string[]) => SetMetadata(PAPEIS_CHAVE, papeis);
