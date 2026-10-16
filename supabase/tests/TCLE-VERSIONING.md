# TCLE: versões e revisão editorial 2026-10-15-v3

## Versão atual v3

A v3 remove somente a confirmação repetida `aceite_dados` / `tratamento_dados` dos seis termos por procedimento. As declarações gerais permanecem na anamnese, cujo recebimento deve ser conferido pela profissional. O TCLE não passa a comprovar esse recebimento e não herda nem inventa uma resposta da anamnese.

Os aceites de leitura, veracidade das respostas específicas do procedimento, decisão livre, revisão profissional, riscos específicos e assinatura permanecem exigidos. As escolhas de imagem e publicidade continuam independentes, inclusive a opção negativa. A seção informativa de privacidade permanece integral. Os 80 itens dos questionários e as explicações de riscos e cuidados não foram removidos.

O novo payload não contém `tratamento_dados`. Os seis normalizadores rejeitam sua presença em v3, tanto `true` como `false`, e não gravam esse campo. O PDF v3 não imprime uma aceitação geral que não foi solicitada. Na recuperação de v1/v2, a declaração original continua obrigatória e o PDF mantém a redação anterior. Nenhum registro assinado é migrado ou reescrito.

O manifesto `tcle-term-manifest.json` registra os arquivos e SHA-256 das três versões para os seis documentos. A normalização usada no hash é UTF-8, quebras LF e remoção apenas dos espaços externos ao texto. Os arquivos `termo-v1.txt` e `termo-v2.txt` são imutáveis.

Esta alteração é editorial e técnica. Não atesta validade clínica ou jurídica dos documentos. A conferência profissional do conteúdo e do atendimento continua necessária.

## Histórico da revisão v2

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

- Novos envios devem usar a versão atual v3 e o hash correspondente.
- Repetir um envio v1/v2 já recebido retorna o mesmo registro e o mesmo PDF, sem recriar nem sobrescrever o documento.
- Um envio v1/v2 interrompido (`erro` ou `processando` fora da janela ativa) pode ser retomado conservando sua versão e hash em texto, código, PDF e registro. Validações existentes de tempo, assinatura, respostas e identidade continuam aplicadas.
- A recuperação exige tipo, versão e hash conhecidos iguais aos do registro armazenado, além da identificação já exigida. Não converte silenciosamente um registro histórico em v3.
- A recuperação concorrente mantém o bloqueio por status e `updated_at`; uma requisição que perdeu a disputa não apaga nem envia arquivos.
- O vínculo do aplicativo com documentos clínicos existentes continua lendo a versão do próprio documento; nenhum registro histórico é migrado.

## Validação técnica

Executar com Node 24 e `pdf-lib` instalado no projeto ou no runtime disponibilizado:

```text
node --test supabase/tests/tcle-version-history.test.mjs
```

Os testes executam os handlers reais com banco, storage e rede simulados, utilizando a geração real de PDFs com `pdf-lib`. Os dados e a assinatura são sintéticos e nunca são enviados a serviços externos. Verificam hashes históricos; paridade das perguntas entre front-end e backend; recuperação histórica; rejeição de novo envio obsoleto; adulteração de texto/assinatura; identidade; disputa de recuperação; conflito de inserção; e a ausência de consentimento geral inventado no payload, no registro e no PDF v3. Também abrem novamente os PDFs gerados com a biblioteca. Consulte o resultado da execução para a contagem atual de casos.

Estes testes não substituem inspeção visual do PDF, homologação da profissional, um teste autorizado na infraestrutura publicada ou teste em celular físico.

## Publicação

1. Publicar as seis Edge Functions com o novo módulo compartilhado `_shared/tcle-term-versions.ts`: `tcle-submit`, `tcle-preenchimento-submit`, `tcle-intradermoterapia-submit`, `tcle-bioestimulador-submit`, `tcle-peeling-quimico-submit`, `tcle-fios-pdo-submit`.
2. Confirmar as seis implantações antes de publicar o front-end v3. Entre as duas etapas, formulários antigos ainda não enviados poderão pedir atualização; não altere seus dados ou marque-os como recebidos para contornar essa verificação.
3. Publicar `termo-v3.txt`, `tcle.js` e as referências de versão/cache em cada HTML. Manter todos os `termo-v1.txt` e `termo-v2.txt` disponíveis.
4. Confirmar pela URL publicada o texto, a versão e o hash de cada formulário. Não há migração SQL nesta revisão.

Após receber qualquer documento v3, não restaurar cegamente uma função antiga que conheça somente v1/v2: isso impediria recuperar v3. Uma correção ou reversão deve manter o catálogo histórico v1/v2/v3 e a lógica de recuperação, mesmo que a versão aceita para novos envios seja alterada. Nenhuma migração SQL é necessária para esta revisão.
