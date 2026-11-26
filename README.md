# FaceMagic AI

Plataforma em desenvolvimento para criação de imagens sintéticas com IA, com foco em consentimento, privacidade e uso responsável.

## O que já está no código
- Interface web responsiva com upload e pré-visualização local.\n- Seletor de cenários para vídeo com fundos predefinidos e upload de imagem personalizada (prévia no navegador; renderização final de vídeo ainda pendente).
- Área de cadastro/login com sessão temporária no navegador.
- API FastAPI com validação de imagens, health check e endpoint de capacidades.
- Conexão PostgreSQL/Neon via psycopg, criação automática das tabelas e autenticação com hash Argon2 + token JWT.
- Saldo inicial de créditos zerado, extrato e endpoint administrativo protegido para adicionar créditos.
- Estrutura do motor de IA mantida desativada até aprovar modelo e licença.
- Configuração inicial para Netlify e Render.

## O que ainda não está funcional
**A transformação facial real não está habilitada.** Também faltam armazenamento privado de imagens, worker/fila de inferência, cobrança/compra de créditos, vídeo e aplicativo Windows/câmera virtual. O saldo de créditos não é consumido por nenhum processamento até o motor e o fluxo de tarefas serem implementados.

## Publicação
- Netlify: publicar a pasta `frontend`.
- Render: blueprint em `render.yaml`, serviço com rootDir `backend`.
- Neon: criar um projeto PostgreSQL e fornecer a connection string como segredo `DATABASE_URL` no Render.
- Render deve gerar `JWT_SECRET` e `ADMIN_API_KEY` automaticamente via blueprint. Não copie essas chaves para o frontend nem para o Git.
- Depois da publicação, substituir `ALLOWED_ORIGINS=*` pela URL exata do site Netlify e definir `window.FACEMAGIC_API_URL` em `frontend/config.js` com a URL pública do serviço Render.

## Desenvolvimento local
```bash
cd backend
python -m venv .venv
# Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app:app --reload
```
Configure as variáveis de `backend/.env.example` no ambiente antes de iniciar. O schema é criado na inicialização se `DATABASE_URL` estiver configurada.

## Próximas etapas obrigatórias
Consulte `docs/ROADMAP.md`. A escolha do modelo depende da licença comercial dos pesos, custo e quota de GPU. Render Free não oferece GPU dedicada. A câmera virtual exige aplicativo desktop separado e testes por aplicativo.
