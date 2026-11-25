# FaceMagic AI — checklist de implementação

## Preparado no repositório
- [x] Interface inicial e pré-visualização local dos uploads.
- [x] API FastAPI com health check e validação de imagens.
- [x] Configuração inicial Netlify/Render.
- [x] Contrato isolado para motor, mantendo-o desativado por segurança.
- [x] Esquema PostgreSQL inicial para contas, créditos, tarefas e consentimento.
- [x] Documentação de arquitetura, privacidade e limitações.

## Ainda precisa de implementação e testes
- [ ] Escolher modelo de face swap com licença comercial explícita para código e pesos.
- [ ] Confirmar custo, quota e capacidade de execução; Render Free não é GPU.
- [ ] Implementar adaptador real do modelo e testes de qualidade/segurança.
- [ ] Criar worker/fila de processamento e recuperação de tarefas.
- [x] Conectar Neon, criar schema automaticamente e implementar cadastro/login e saldo/extrato básico de créditos.
- [ ] Implementar compra/consumo de créditos ligado a tarefas reais, com transações e reembolso em falhas.
- [ ] Implementar cadastro, login, recuperação de conta e sessões seguras.
- [ ] Selecionar armazenamento privado, URLs assinadas e exclusão automática.
- [ ] Implementar painel do usuário, galeria, histórico, download e exclusão.
- [ ] Implementar painel administrativo, limites, auditoria e suporte.
- [ ] Rate limiting, moderação, denúncia, prevenção de abuso e testes de carga.
- [ ] Vídeo: pipeline FFmpeg, limites de duração/resolução e worker dedicado.
- [ ] Aplicativo Windows: webcam, tracking, preview e câmera virtual.
- [ ] Testar WhatsApp Desktop, Messenger e demais clientes individualmente.
- [ ] Testar Android separadamente; não há câmera virtual universal para outros apps.
- [ ] Configurar domínios, CORS, variáveis, migrações e monitoramento na hospedagem.

## Regra de lançamento
Não cobrar créditos nem anunciar geração funcional enquanto o motor real, a licença, a medição de custo e o fluxo de exclusão não tiverem sido testados de ponta a ponta.
