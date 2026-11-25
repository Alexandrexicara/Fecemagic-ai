# FaceMagic AI

Plataforma inicial para transformação de imagens com IA.

## Estado atual
Esta primeira versão cria a interface e a API-base. O processamento real de face swap permanece desativado até selecionarmos um modelo com licença comercial compatível e ambiente de execução gratuito. Não há chamadas a APIs pagas nem chave secreta no frontend.

## Estrutura
- `frontend/`: interface web responsiva para upload de foto de origem e imagem de referência.
- `backend/`: API Python para saúde do serviço e validação de uploads.
- `render.yaml`: configuração inicial do backend no Render.
- `netlify.toml`: publicação do frontend na Netlify.

## Desenvolvimento local
Backend:
```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --reload
```

Frontend: abra `frontend/index.html` com um servidor estático. Configure `API_BASE_URL` em `frontend/app.js` para apontar ao backend.

## Variáveis
- `ALLOWED_ORIGINS`: origens autorizadas, separadas por vírgula.
- `MAX_UPLOAD_MB`: limite de upload (padrão 12 MB).

Não coloque tokens NVIDIA ou outras credenciais no código. Configure segredos apenas no painel do serviço de hospedagem.

## Próximas etapas
1. Validar um modelo de face swap com licença comercial apropriada.
2. Definir execução local/GPU e limites reais de gratuidade.
3. Implementar processamento real, autenticação, créditos, armazenamento privado e exclusão automática.
4. Testar compatibilidade da câmera virtual no desktop.
