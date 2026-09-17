# Motion 0.2.0

Motion adiciona animações contextuais ao Discord no Revenge Next sem aplicar o mesmo fade/scale à raiz do aplicativo para cada ação.

## Integração

- **Navegação:** observa o `RootNavigationRef` público e anima o `Design.LayerScope` de destino quando ele é montado. Quando o estado de navegação permite, diferencia avanço e retorno.
- **Canais e conversas:** observa `CHANNEL_SELECT` e reinicia a transição da superfície de tela ativa, interrompendo a anterior em vez de enfileirar animações.
- **Servidores:** usa `guildId` do evento quando disponível e `ChannelStore` como complemento para distinguir uma troca real de guild de uma simples troca de canal.
- **Menus e modais:** anima o conteúdo de `Design.ActionSheet` e conteúdo elementar de `Design.AlertModal`. O fechamento continua usando a animação/lifecycle nativo do Discord, evitando patches frágeis em métodos internos.
- **Botões:** usa `scaleAmountInPx` dos componentes `Button`, `IconButton` e `ImageButton` sem substituir a identidade do componente, refs ou handlers. Um valor explícito já fornecido por outro código é preservado.

## Presets

Os parâmetros ficam centralizados em `js/presets.ts`:

- **Suave:** rápido, discreto e com pouco deslocamento.
- **Fluido:** padrão equilibrado para uso diário.
- **Elástico:** mais expressivo, com `back easing` moderado e sem exagero.

Todos os timings usam `useNativeDriver: true` e `isInteraction: false`.

## Reduce Motion e cleanup

Quando **Respeitar Reduzir animações** está habilitado, `AccessibilityInfo.isReduceMotionEnabled()` e o evento `reduceMotionChanged` impedem novos efeitos. Se o Android ativar Reduce Motion durante uma transição, todas as animações ativas são interrompidas e opacity/translate/scale são restaurados imediatamente.

Ao desligar o plugin, o Motion interrompe animações, restaura valores, remove hooks JSX, listeners de navegação/Flux/acessibilidade e referências internas. Inicializações repetidas substituem a instalação anterior em vez de multiplicar listeners.

## Compatibilidade

No Revenge Next atual, a implementação principal usa APIs públicas/tipadas: `Design.LayerScope`, `Design.ActionSheet`, `Design.AlertModal`, `RootNavigationRef`, `getStore` e `onFluxEventDispatched`.

Existe apenas um fallback de compatibilidade para hosts antigos/ambientes de teste que não exponham `Design.LayerScope`: nesse caso, um host leve pode ser anexado ao `AppContainer`. Ele não transforma a árvore do Discord; exibe somente um pequeno acento visual. O patch de `React.createElement` é instalado apenas nesse fallback e fica restrito às identidades de `AppContainer` descobertas.
