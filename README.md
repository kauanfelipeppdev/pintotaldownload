# PinTotalDownload

Extensão para Chrome (e navegadores baseados em Chromium, como Brave e Edge) que baixa **pastas inteiras do Pinterest** com um clique, de graça.

## Recursos

- Baixa **todos os pins** de uma pasta, sem precisar rolar a página
- Imagens na **resolução original**
- **Vídeos** em mp4 (opcional)
- **Carrosséis** (todas as imagens) e **Idea Pins**
- **Seções** da pasta viram subpastas (opcional); abrindo uma seção, baixa só ela
- Painel de progresso na página, com botão de cancelar

## Instalação

1. Baixe este repositório (**Code → Download ZIP**) e extraia, ou clone:
   ```
   git clone https://github.com/kauanfelipeppdev/pintotaldownload.git
   ```
2. Abra `chrome://extensions` (ou `brave://extensions`, `edge://extensions`).
3. Ative o **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação** e selecione a pasta do projeto.

## Como usar

1. **Faça login no Pinterest.** Sem login, o Pinterest só libera os primeiros ~25 pins de cada pasta.
2. Abra uma pasta, por exemplo `pinterest.com/usuario/nome-da-pasta/`.
3. Clique no botão vermelho **⬇ Baixar pasta** no canto inferior direito, ou no ícone da extensão.

Os arquivos são salvos em:

```
Downloads/PinTotalDownload/<usuário> - <pasta>/
├── 0001_<id-do-pin>.jpg
├── 0002_<id-do-pin>.mp4
└── <Seção>/
    └── 0001_<id-do-pin>.jpg
```

Pelo ícone da extensão você liga ou desliga **seções** e **vídeos**.

### Dicas

- Desative **"Perguntar onde salvar cada arquivo"** nas configurações de downloads do navegador, senão ele abre uma janela para cada imagem.
- Na primeira vez, o navegador pode pedir permissão para **baixar vários arquivos**: clique em **Permitir**.

## Como funciona

O content script usa a mesma API interna (`/resource/...`) que o site do Pinterest usa, com os cookies da sua sessão:

- `BoardResource`: dados da pasta
- `BoardFeedResource`: pins da pasta, paginados
- `BoardSectionsResource` / `BoardSectionPinsResource`: seções e seus pins

Cada mídia é enviada ao service worker, que a entrega para `chrome.downloads`. Nenhum dado sai do seu navegador para outros servidores.

> A API interna do Pinterest não é oficial e pode mudar sem aviso. Se a extensão parar de funcionar, abra uma issue com a mensagem de erro que aparece no painel.

## Estrutura

| Arquivo | Função |
|---|---|
| `manifest.json` | Configuração da extensão (Manifest V3) |
| `content.js` / `content.css` | Botão, painel e coleta dos pins na página |
| `background.js` | Service worker que dispara os downloads |
| `popup.html` / `popup.js` | Popup do ícone, com as opções |
| `icons/` | Ícones da extensão |

## Aviso

Use para baixar conteúdo seu ou com permissão dos autores, respeitando os direitos autorais e os Termos de Serviço do Pinterest.
