# FaceMagic AI — checklist de implementação

## Preparado no repositório
- [x] Interface web responsiva e pré-visualização local dos uploads.
- [x] API FastAPI com health check, capacidades e validação de imagens.
- [x] Configuração inicial Netlify/Render.
- [x] Contrato isolado do motor de IA, mantido desativado por segurança.
- [x] PostgreSQL/Neon: conexão, criação automática do schema e tabelas de usuários, créditos, tarefas e consentimento.
- [x] Cadastro e login com hash Argon2, token JWT, consulta de perfil e sessão de navegador.
- [x] Saldo inicial de créditos, extrato e endpoint administrativo protegido para adicionar créditos.
- [x] Variáveis de ambiente documentadas e geração de segredos JWT/admin no blueprint Render.
- [x] Documentação de arquitetura, privacidade e análise de licenças dos modelos.

## Interface de cenários adicionada\n- [x] Seletor visual de cenários predefinidos (original, escritório, praia, estúdio, cidade, biblioteca e natureza).\n- [x] Upload e prévia local de imagem de fundo personalizada.\n- [ ] Composição real do cenário no vídeo exportado (depende do pipeline de vídeo).\n\n## Ainda precisa de implementação e testes
- [ ] Escolher um conjunto completo de modelos com licença comercial confirmada para face swap.
- [ ] Confirmar custo, quota e capacidade de execução; Render Free não oferece GPU dedicada.
- [ ] Implementar o adaptador real do modelo e testes de qualidade/segurança.
- [ ] Criar worker/fila de processamento e recuperação de tarefas.
- [ ] Implementar consumo transacional de créditos, estorno e compra/pagamento.
- [ ] Recuperação de senha e verificação de e-mail (dependem de provedor de e-mail).
- [ ] Selecionar armazenamento privado, URLs assinadas e exclusão automática.
- [ ] Implementar painel do usuário, galeria, histórico, download e exclusão.
- [ ] Implementar painel administrativo, limites, auditoria e suporte.
- [ ] Rate limiting, moderação, denúncia, prevenção de abuso e testes de carga.
- [ ] Vídeo: pipeline FFmpeg, limites de duração/resolução e worker dedicado.
- [ ] Aplicativo Windows: webcam, tracking, preview e câmera virtual.
- [ ] Testar WhatsApp Desktop, Messenger e demais clientes individualmente.
- [ ] Testar Android separadamente; não há câmera virtual universal para outros apps.
- [ ] Configurar domínio, CORS restrito, variáveis, migrações e monitoramento após a hospedagem.

## Regra de lançamento
Não cobrar créditos nem anunciar geração funcional enquanto o motor real, a licença, a medição de custo, o armazenamento e o fluxo de exclusão não tiverem sido testados de ponta a ponta.
