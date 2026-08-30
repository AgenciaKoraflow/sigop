# Ícones do PWA

Gere os ícones em todos os tamanhos listados em `public/manifest.json`:

| Arquivo             | Tamanho   | purpose    |
| ------------------- | --------- | ---------- |
| `icon-72x72.png`    | 72×72     | any        |
| `icon-96x96.png`    | 96×96     | any        |
| `icon-128x128.png`  | 128×128   | any        |
| `icon-144x144.png`  | 144×144   | any        |
| `icon-152x152.png`  | 152×152   | any        |
| `icon-192x192.png`  | 192×192   | maskable   |
| `icon-384x384.png`  | 384×384   | any        |
| `icon-512x512.png`  | 512×512   | maskable   |

## Como gerar

Você pode usar:

- https://realfavicongenerator.net — gera todos os tamanhos + apple-touch-icon
- https://maskable.app/editor — valida a safe zone dos ícones `maskable`

## Diretrizes de arte

Use um ícone com escudo/badge em azul (`#3b5fc0`) sobre fundo escuro (`#0a0f1e`).

Para os ícones `maskable` (192×192 e 512×512), mantenha o símbolo dentro da
"safe zone" central (~80% da área) para não ser cortado em telas Android.
