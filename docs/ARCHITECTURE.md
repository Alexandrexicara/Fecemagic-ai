# FaceMagic AI — arquitetura planejada

## Componentes
- **Frontend Netlify:** interface responsiva, seleção de imagens, histórico, conta, créditos e avisos de conteúdo sintético.
- **API Render (FastAPI):** validação, autenticação, autorização, criação de tarefas e integração com o motor. O plano gratuito de CPU serve para testes leves, não garante inferência de IA.
- **Neon/Postgres:** usuários, saldos, lançamentos, tarefas e registros de consentimento.
- **Armazenamento privado:** imagens e resultados fora do banco, com URLs temporárias, limite de tamanho e exclusão automática. Provedor ainda precisa ser escolhido; não assumir que será gratuito.
- **Worker de IA:** processo separado para inferência. Idealmente GPU local do operador ou infraestrutura com quota gratuita confirmada; não misturar inferência pesada com a API web.
- **Aplicativo desktop futuro:** captura de webcam, rastreamento facial e câmera virtual do sistema operacional.

## Fluxo de imagem (quando habilitado)
1. Usuário autentica e confirma direitos/consentimento.
2. API valida formato, tamanho e limites de uso.
3. Arquivos são enviados a armazenamento privado com expiração.
4. API cria tarefa e reserva créditos de forma transacional.
5. Worker processa com modelo aprovado e grava resultado privado.
6. Usuário recebe URL temporária; tarefa e arquivos expiram conforme política.
7. Falha libera/reserva créditos de acordo com regra auditável.

## Segurança e privacidade
- Segredos apenas em variáveis de ambiente do backend.
- Não registrar conteúdo binário, tokens ou URLs assinadas nos logs.
- Rate limit, limites por usuário, validação real do conteúdo e proteção contra abuso antes de abrir cadastro público.
- Consentimento afirmativo, finalidade clara, denúncia e exclusão de conteúdo.
- Rotular resultados como alterados/gerados por IA e impedir apresentação enganosa como prova ou registro autêntico.

## Limitações importantes
- Netlify não executa o motor de IA.
- Render Free não oferece GPU dedicada e pode suspender/limitar serviços; não é base confiável para vídeo em tempo real.
- Câmera virtual exige aplicativo desktop e testes em cada aplicativo de chamada. Não é uma integração que o site sozinho consegue instalar no WhatsApp/Facebook.
- Nenhum modelo será ativado antes de conferir licença dos pesos e uso comercial.
