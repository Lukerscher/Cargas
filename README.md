# AlmoxControl

Sistema web de gestão de estoque, notas fiscais, conferência de cargas e inventário, com perfis de acesso, relatórios e backup local.

## Executar localmente

Requisitos: Python 3.11 ou superior.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
flask --app app create-admin
flask --app app run --debug
```

Abra `http://127.0.0.1:5000`. Os dados ficam em `instance/almoxcontrol.sqlite`; a chave de sessão é criada em `instance/.secret_key`. A pasta `instance/` não deve ser enviada para o Git.

O primeiro administrador é criado pelo comando `flask --app app create-admin`, que pede a senha sem gravá-la no histórico do terminal. Usuários adicionais são criados na tela **Usuários**. Senhas precisam ter no mínimo 10 caracteres.

## Perfis

- **Administrador:** todos os módulos, usuários, permissões, backup e recuperação.
- **Almoxarife:** catálogo, fornecedores, categorias, notas, movimentações, cargas e inventário.
- **Conferente:** consulta produtos e registra conferências de carga; não altera saldos.

## Funcionalidades

- Cadastro de produtos, categorias, fornecedores, código de barras e estoque mínimo.
- Entradas, saídas e ajustes com usuário, horário e referência. O sistema bloqueia saídas acima do saldo disponível.
- Importação de até 20 XML de NF-e por lote, com resultado individual por arquivo, bloqueio por chave duplicada e entrada automática dos itens associados ao catálogo.
- Exclusão auditada de NF-e com estorno das entradas vinculadas. A exclusão é bloqueada se o saldo tiver sido consumido ou se a origem dos movimentos não puder ser confirmada.
- Conferência de cargas com leitura única por produto e registro da quantidade total, sem somar leituras repetidas.
- Cargas podem ser vinculadas a várias NF-e; os produtos e quantidades previstos são somados automaticamente para orientar a leitura. O progresso e as divergências ficam visíveis; quantidades podem ser corrigidas (inclusive zero para item ausente) ou desfeitas com auditoria, e divergências exigem confirmação antes do encerramento. A conferência não movimenta o estoque. Placa, motorista e observações ficam registrados na carga.
- Inventário físico que compara saldos e aplica ajustes ao ser concluído.
- Relatórios filtráveis por período, produto, categoria, fornecedor e responsável, exportados em CSV e Excel.
- Backup íntegro do SQLite por download e restauração com verificação de integridade.

O XML é processado localmente usando bibliotecas convencionais. Itens ainda não cadastrados criam produtos com descrição, unidade, código do fornecedor ou código de barras, fornecedor, estoque inicial e referência da primeira NF de origem. Códigos de fornecedor iguais de fornecedores diferentes geram registros separados; um GTIN já conhecido reutiliza o produto existente. Itens sem código de fornecedor e sem código de barras não podem ser cadastrados automaticamente e fazem aquela NF falhar sem criar entrada parcial.

## Testes

```bash
python -m unittest discover -s tests
```

## Publicação online

O GitHub Pages hospeda apenas arquivos estáticos e não atende autenticação, banco persistente ou importação de arquivos. O arquivo [`render.yaml`](render.yaml) configura um serviço web no Render, conectado a este repositório GitHub, com disco persistente e banco SQLite.

1. Envie o projeto para o GitHub e abra o Blueprint do Render: [render.com/deploy](https://render.com/deploy).
2. Conecte este repositório e confirme o plano com disco persistente. A persistência de arquivos não está disponível no plano gratuito do serviço web.
3. Após o deploy, abra o Shell do serviço e execute `flask --app app create-admin` para criar o primeiro administrador.
4. Acesse a URL fornecida pelo Render. O deploy automático atualiza o serviço após novos envios à branch `main`.

O disco persistente contém o banco em `/var/data/almoxcontrol.sqlite`. Configure uma rotina externa para baixar e armazenar cópias do backup; uma cópia mantida apenas no mesmo serviço não cobre falha do disco.

### Produção

Use HTTPS, mantenha `SECRET_KEY` confidencial, restrinja acesso administrativo, execute backups periódicos e teste a restauração. O SQLite e um único worker Gunicorn são apropriados para a implantação inicial; crescimento de concorrência deve ser acompanhado de migração planejada para PostgreSQL. Não envie bancos, chaves de sessão ou credenciais para o repositório.