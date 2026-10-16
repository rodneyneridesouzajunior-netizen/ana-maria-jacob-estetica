# TCLE: revisão editorial 2026-10-15-v2

Esta revisão remove somente a repetição literal do questionário no texto corrido. As perguntas, opções de resposta, explicações obrigatórias, validações e a inclusão das respostas no PDF continuam presentes. Não altera indicações, contraindicações, riscos, direitos, declarações ou necessidade de revisão e assinatura profissional. Não constitui aprovação clínica ou parecer jurídico.

Os arquivos `termo-v1.txt` permanecem intactos. A nova redação referencia expressamente o questionário completo e sua inclusão na cópia digital. Os seis arquivos `termo-v2.txt` contêm a nova versão e vigência. O layout não mudou: o HTML altera apenas o número da versão e a chave de cache do JavaScript.

| Formulário | Perguntas mantidas | Repetições removidas do texto | SHA-256 v2 (LF, sem espaços finais) |
| --- | ---: | ---: | --- |
| Toxina | 17 | 0; referência ao anexo esclarecida | `a455dc7d5d0f6bc63afef6b02492b2070665092e79f56bf0d4dbddd07273ea66` |
| Preenchimento | 17 | 17 | `c08d41af2d0358a064c8cded9b54cf4cd0c32b63b07a953ce25212f87998cab9` |
| Intradermoterapia | 14 | 14 | `4642ac82b2b796fe5782431f8611f4eaf60f985f9ebc29374b10324d9ed74d86` |
| Bioestimulador | 8 | 8 | `15cfff64ccb226d459c9dad3ff283ee0d1f41d28899d4285bb2f34bbe3666eca` |
| Peeling químico | 11 | 11 | `941fbbbfcb0ffc1ccc282f7771a9907f0de6b01f20405e1cade6363d462b0690` |
| Fios PDO | 13 | 13 | `c68e4bf913915671063923e25588720c891b5ffdc2e585469373a1f4a9f568e4` |

## Compatibilidade histórica

- Novos envios devem usar a versão atual v2 e o hash correspondente.
- Repetir um envio v1 já recebido retorna o mesmo registro e o mesmo PDF, sem recriar nem sobrescrever o documento.
- Um envio v1 interrompido (`erro` ou `processando` fora da janela ativa) pode ser retomado conservando a versão e o hash v1 em texto, código, PDF e registro. Validações existentes de tempo, assinatura, respostas e identidade continuam aplicadas.
- A recuperação exige tipo, versão e hash conhecidos iguais aos do registro armazenado, além da identificação já exigida. Não converte silenciosamente um registro v1 em v2.
- A recuperação concorrente mantém o bloqueio por status e `updated_at`; uma requisição que perdeu a disputa não apaga nem envia arquivos.
- O vínculo do aplicativo com documentos clínicos existentes continua lendo a versão do próprio documento; nenhum registro histórico é migrado.

## Validação técnica

Executar com Node 24 e `pdf-lib` instalado no projeto ou no runtime disponibilizado:

```text
node --test supabase/tests/tcle-version-history.test.mjs
```

São 48 testes, oito para cada procedimento. Executam os handlers reais com banco, storage e rede simulados, utilizando a geração real de PDFs com `pdf-lib`. Os dados e a assinatura são sintéticos e nunca são enviados a serviços externos. Verificam os hashes imutáveis v1; preservação dos demais parágrafos; paridade das 80 perguntas entre front-end e backend; cada pergunta uma única vez no PDF v2; recuperação v1; rejeição de novo envio obsoleto; adulteração de texto/assinatura; identidade; disputa de recuperação; conflito de inserção. Também abrem novamente os PDFs gerados com a biblioteca.

Estes testes não substituem inspeção visual do PDF, homologação da profissional, um teste autorizado na infraestrutura publicada ou teste em celular físico.

## Publicação

1. Publicar as seis Edge Functions com o novo módulo compartilhado `_shared/tcle-term-versions.ts`: `tcle-submit`, `tcle-preenchimento-submit`, `tcle-intradermoterapia-submit`, `tcle-bioestimulador-submit`, `tcle-peeling-quimico-submit`, `tcle-fios-pdo-submit`.
2. Confirmar as seis implantações antes de publicar o front-end v2. Entre as duas etapas, formulários antigos ainda não enviados poderão pedir atualização; não altere seus dados ou marque-os como recebidos para contornar essa verificação.
3. Publicar `termo-v2.txt`, `tcle.js` e as referências de versão/cache em cada HTML. Manter todos os `termo-v1.txt` disponíveis.
4. Confirmar pela URL publicada o texto, a versão e o hash de cada formulário. Não há migração SQL nesta revisão.

Após receber qualquer documento v2, não restaurar cegamente uma função antiga que conheça somente v1: isso impediria recuperar v2. Uma correção ou reversão deve manter o catálogo histórico v1/v2 e a lógica de recuperação, mesmo que a versão aceita para novos envios seja alterada.
