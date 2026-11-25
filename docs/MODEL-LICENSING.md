# Seleção e licença do motor de face swap

**Status: bloqueado para uso comercial até confirmação escrita/inequívoca das licenças dos pesos e de todos os modelos auxiliares.**

Não basta o código ser open source. O peso do face swap, os modelos de detecção/alinhamento e o framework podem ter termos diferentes.

## Verificações oficiais realizadas

- InsightFace informa que o código é MIT, mas os modelos pré-treinados do repositório são para pesquisa não comercial. Para a família InSwapper, o projeto orienta entrar em contato para obter licença. Fonte: https://github.com/deepinsight/insightface
- A página de licenças do FaceFusion lista licenças individuais para cada modelo: há modelos não comerciais, ResearchRAIL e outros com licenças permissivas. O framework também tem licença própria OpenRAIL-AS. Fonte: https://docs.facefusion.io/introduction/licenses
- A documentação do FaceFusion lista vários modelos de face swap e não autoriza presumir que todos podem ser usados comercialmente. Fonte: https://docs.facefusion.io/usage/cli-arguments/processors/face-swapper

## Decisão para o FaceMagic AI

1. Não baixar nem redistribuir pesos InSwapper/InsightFace para um produto comercial sem a licença correspondente.
2. Não habilitar HyperSwap ou outros modelos marcados como ResearchRAIL sem analisar os termos completos.
3. Mesmo quando o peso do swapper tem Apache 2.0, verificar os modelos auxiliares de detecção, alinhamento e identidade, além da licença do framework.
4. Priorizar um conjunto completo de modelos com licenças compatíveis com uso comercial e redistribuição/implantação, ou obter licença comercial diretamente dos titulares.
5. Registrar os arquivos de licença, versão, origem e hashes dos pesos antes de habilitar o motor.

## Requisitos de infraestrutura

O processamento de imagem pode exigir CPU/GPU, memória e armazenamento temporário. O plano gratuito do Render não fornece GPU dedicada; portanto, não é correto prometer processamento gratuito ilimitado ou em tempo real. A alternativa futura pode ser um worker local do operador, desde que fique online e tenha hardware compatível, ou um provedor com quota gratuita confirmada.

Até essas verificações serem concluídas, o motor permanece desativado por padrão no backend.
