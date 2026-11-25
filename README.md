# FaceMagic AI

Plataforma em desenvolvimento para criação de imagens sintéticas com IA, com foco em consentimento, privacidade e uso responsável.

## Estado real do projeto
A interface web e a API-base estão preparadas. O backend valida imagens e informa capacidades. **A transformação facial real ainda não está habilitada.** Não há ainda cadastro/login, créditos ativos, armazenamento privado, geração de vídeos ou câmera virtual. Não anuncie nem cobre por processamento até o fluxo completo ser implementado e testado.

## Estrutura
- `frontend/`: interface web e configuração pública do endereço da API.
- `backend/`: FastAPI, validação, status/capacidades e contrato de processamento desativado.
- `database/schema.sql`: esquema PostgreSQL inicial, ainda não aplicado.
- `desktop/`: plano técnico do futuro aplicativo Windows/câmera virtual.
- `docs/`: arquitetura e checklist de implementação.
- `render.yaml` e `netlify.toml`: configurações iniciais de hospedagem.

## Desenvolvimento local
```bash
cd backend
python -m venv .venv
# Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app:app --reload
``
Abra o frontend por um servidor estático e defina a URL pública da API em `frontend/config.js` quando houver backend publicado.

## Variáveis de ambiente
Veja `backend/.env.example`. Credenciais e tokens devem ficar somente nos segredos do backend; nunca no frontend ou no Git.

## Próximas etapas
Consulte `docs/ROADMAP.md`. A escolha do modelo depende de licença comercial dos pesos, custo/limites de GPU e qualidade. Render Free não oferece GPU dedicada. A câmera virtual exige aplicativo desktop separado e testes por aplicativo.
