# Mina Translator para Kettu — 0.1.0

Versão inicial para testar no celular: tradução automática de mensagens recebidas e enviadas.

## Instalação pelo celular

1. Instale e abra o Kettu. Na seção **Plugins**, adicione esta URL:

   ```text
   https://raw.githubusercontent.com/minatanky-source/mina-revenge-plugins/kettu/gemini-offline-translator/kettu/auto-translator/
   ```

2. Abra as configurações do **Mina Translator**.
3. Escolha o modo e configure conforme abaixo. Use **Testar Gemini** ou **Testar Offline** antes de conversar.

### Gemini

1. Abra https://aistudio.google.com/apikey e crie uma chave em um projeto **Free Tier**, sem ativar faturamento. Não envie a chave pelo Discord nem pelo ChatGPT.
2. Cole a chave somente no campo **Chave do Gemini** do plugin. Saia do campo para salvar.
3. Confirme no plugin que o projeto é gratuito e use **Testar Gemini**.

O modelo inicial é `gemini-3.5-flash-lite`. O modelo é configurável porque a disponibilidade muda. A API tem cotas por projeto; o plugin pausa após erro de cota e não ativa cobrança. Ele não tem como verificar o faturamento da sua conta: uma chave de projeto pago pode gerar custos mesmo com a caixa marcada.

O texto e até três mensagens da mesma conversa são enviados ao Google para contextualizar gírias. No Free Tier, o Google pode usar entradas e saídas para melhorar seus produtos. A chave é salva no armazenamento privado de configurações do Kettu; esse armazenamento não é um cofre criptografado, e plugins no mesmo processo podem ter acesso a ele. Não há servidor do desenvolvedor nem telemetria própria.

### Offline

1. Instale o APK **Mina Offline** fornecido com esta versão (ou baixe o artefato `mina-offline-apk` na execução do workflow **Kettu translator and offline APK** do GitHub).
2. Abra o app. Deixe `pt,en` para português/inglês e toque em **Baixar idiomas por Wi-Fi**. Espere a confirmação. Cada modelo ocupa aproximadamente 30 MB; inglês é intermediário.
3. Toque em **Iniciar tradutor**, depois em **Copiar código de conexão**.
4. Cole o código no campo **Código de conexão do Mina Offline** no plugin. Saia do campo para salvar e toque em **Testar Offline**.

No offline, os idiomas de origem são explícitos: por padrão, as mensagens recebidas são tratadas como inglês e suas mensagens como português. Ajuste esses campos ao mudar de idioma; baixe os idiomas correspondentes no app. Não há detecção automática no offline nesta versão.

O app escuta somente em `127.0.0.1:17843`, exige um código aleatório de 256 bits, rejeita pedidos com Origin e não oferece CORS. As traduções são feitas pelo ML Kit no aparelho; o texto não é enviado ao Gemini. O download inicial dos modelos precisa de internet. O app não salva mensagens. O motor offline é o Google Tradutor e pode interpretar mal gírias, ironia e abreviações.

**Offline se refere à tradução. O Discord precisa de internet para receber e enviar mensagens.** Se o Android encerrar o app auxiliar, abra-o e toque em Iniciar. Para desligar, use Parar no app ou na notificação.

### Modos

| Modo | Comportamento |
|---|---|
| Gemini | Tradução contextual pela API. Sem fallback automático. |
| Offline | Usa exclusivamente o app no aparelho. |
| Automático | Tenta Gemini e usa o offline em falha de conexão, timeout, cota ou indisponibilidade do serviço. Não contorna recusas de segurança nem chaves inválidas. |

## Uso

- **Ler em:** português brasileiro (`pt-BR`) por padrão.
- **Enviar em:** inglês (`en`) por padrão. Vale para todas as conversas; não detecta o idioma de cada destinatário. Desative a saída automática ao falar português com amigos.
- Mensagens recebidas são alteradas apenas na sua visualização. Ao desativar o plugin, os originais são restaurados quando ainda disponíveis no cache do Discord.
- Suas mensagens são traduzidas antes do envio. Se falhar, o plugin mostra **Mensagem não enviada**, com opções para copiar o texto ou enviar o original explicitamente. Não reenvia mensagens automaticamente.
- Recebidas: processa o canal aberto, até as últimas 24 mensagens do histórico carregado e mensagens novas, em lotes de até 6. Histórico além disso não é traduzido automaticamente nesta versão. Cache da sessão evita pedidos repetidos e é limitado para economizar RAM.
- Texto por mensagem: até 4000 caracteres; expansão de saída além de 2000 caracteres é bloqueada quando fica maior que o original. Não divide mensagens nem altera limites do Discord.
- Links, blocos de código e menções são protegidos. Uma tradução que altere esses elementos é rejeitada.
- A saída respeita a ordem dos envios e preserva anexos, referências de resposta e opções do Discord.
- O diagnóstico copiado não inclui chave, código de conexão nem texto das conversas.

## Validação e limites

- Base Kettu conferida no repositório Codeberg: commit `f5bbcecade9ad508f06d7886af7d79dd5570ec4f` de 27/08/2026.
- 19 testes automatizados do núcleo e integração simulada: tradução local, ordem de envio, preservação de anexos/respostas, bloqueio em falha, cancelamento ao desativar, edição concorrente, timeout, cache, quota e seleção de provedores.
- O workflow compila um APK de desenvolvimento assinado com chave de debug, próprio para teste pessoal. A assinatura pode mudar entre execuções; nesse caso, uma atualização exige desinstalar a versão anterior e configurar novamente.
- **Não testado em um Moto G24 real nem com uma chave Gemini real.** Os testes simulados não validam a qualidade linguística, desempenho ou compatibilidade com os componentes da versão de Discord instalada.
- A conexão offline depende de o cliente permitir HTTP para loopback. Se **Testar Offline** falhar com o app ativo e código correto, envie somente o diagnóstico; pode ser necessário ajustar a integração do cliente. Não exponha o serviço à rede Wi-Fi para tentar resolver.

## Código e compilação

```sh
node --test kettu/auto-translator/tests/*.test.cjs
node kettu/auto-translator/build.cjs
gradle -p kettu/offline-bridge assembleDebug
```

O plugin não precisa de npm/bun nem dependências de build. O app usa JDK 17, Gradle 8.9, Android SDK 35 e ML Kit Translate 17.0.3. O workflow do GitHub faz a compilação sem PC do usuário.

Fontes: https://ai.google.dev/gemini-api/docs/pricing · https://ai.google.dev/gemini-api/docs/billing · https://developers.google.com/ml-kit/language/translation/android · https://codeberg.org/cocobo1/Kettu

Offline: **Powered by Google Translate**. Código distribuído sob GPL-3.0 conforme LICENSE na raiz do repositório.
