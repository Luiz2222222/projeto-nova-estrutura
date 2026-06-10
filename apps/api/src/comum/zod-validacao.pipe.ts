import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

// Valida o corpo da requisição usando um schema Zod (compartilhado com a tela).
export class ZodValidacaoPipe implements PipeTransform {
  constructor(private readonly esquema: ZodSchema) {}

  transform(valor: unknown) {
    const resultado = this.esquema.safeParse(valor);
    if (!resultado.success) {
      const erros = resultado.error.issues.map((i) => ({
        campo: i.path.join('.'),
        mensagem: i.message,
      }));
      throw new BadRequestException({ mensagem: 'Dados inválidos', erros });
    }
    return resultado.data;
  }
}
