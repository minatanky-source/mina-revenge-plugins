# Mina Revenge Plugins

Plugins para **Revenge Next**. Não são compatíveis com o formato de plugins do Classic.

| Plugin | Versão | Correções |
| --- | --- | --- |
| Auto Translator | 0.1.6 | Corrige o comando de status de saída e idiomas inválidos salvos; descarta traduções de saída após mudar a configuração ou desativar o plugin. |
| Large Video Sender | 0.2.2 | Usa o limite e o tamanho informado para cada vídeo no cálculo da compressão. |
| Fix Link | 0.2.1 | Preserva URLs dentro de código entre crases e blocos de código. |
| Motion | 0.1.4 | Evita aplicar duas camadas de animação à mesma tela quando os dois caminhos de criação do React são usados. |

## Atualizar no celular

1. No Revenge, abra **Plugins** e toque na engrenagem no topo para abrir **Advanced**.
2. Em **Updates**, toque em **Check for updates** e depois em **Update all**.
3. Reinicie o Discord para carregar os novos arquivos e aplicar o Motion à tela principal.
4. Confira as versões na tabela acima. Elas ficam disponíveis pelo atualizador depois que as alterações forem incorporadas à `main` e o fluxo **Release plugins** terminar com sucesso.

Se precisar adicionar o repositório, use:

```text
https://raw.githubusercontent.com/minatanky-source/mina-revenge-plugins/gh-pages/index.json
```

## Auto Translator

Os comandos abaixo são locais e não são enviados ao canal enquanto o plugin está ativo:

| Comando | Ação |
| --- | --- |
| `!tr pt` | Escolher português. |
| `!tr on` / `!tr off` | Ativar ou desativar a tradução recebida. Ao desativar, restaurar os originais ainda acompanhados. |
| `!tr out en` | Traduzir suas mensagens para inglês. Aceita outros códigos de idioma, como `es`. |
| `!tr out on` / `!tr out off` | Ativar ou desativar a tradução das suas mensagens. |
| `!tr out` / `!tr out status` | Consultar o idioma e o estado da tradução de saída sem mudar as configurações. |
| `!tr status` | Ver conexão com o chat, contadores, fila e último erro. |
| `!tr test` | Traduzir uma frase de teste e mostrar o resultado em um aviso local. |
| `!tr retry` | Limpar erros e tentar novamente. |

O texto a traduzir é enviado ao Google Translate. Menções, URLs e trechos de código são protegidos antes do envio. A tradução recebida só altera a exibição local. Com a tradução de saída ativa, a versão traduzida da sua mensagem é enviada ao canal.

Se a tradução de saída for desativada ou tiver seu idioma alterado enquanto uma mensagem estiver aguardando o serviço, essa mensagem será enviada no original. Configurações inválidas como o idioma `status`, gravadas por versões anteriores, são corrigidas na inicialização.

## Large Video Sender

O tamanho escolhido (9 ou 19 MB) é um alvo. Quando o Discord informa um limite menor para o vídeo, o cálculo usa esse limite com margem. O limite é acompanhado por vídeo para não misturar uploads de canais diferentes.

O plugin usa o encoder do Discord e mantém o piso de bitrate. Vídeos muito longos podem continuar acima do limite mesmo após a compressão; nesses casos, reduza a duração. A qualidade e o tamanho real do arquivo precisam ser conferidos no Android.

## Fix Link

Os links das plataformas ativadas são convertidos para os provedores configurados, mantendo a apresentação como um ponto. URLs em código entre crases e blocos com três crases permanecem como foram escritas. A prévia depende também da disponibilidade do provedor externo.

## Motion

Nas configurações do plugin, escolha o estilo e os efeitos para navegação, canais, menus e botões. As transições de tela usam um efeito breve de opacidade e escala. Os botões usam a animação de pressão do próprio Discord. Desativar o plugin ou ativar a redução de movimento interrompe os efeitos pendentes.

## Verificação

`bun install --frozen-lockfile`, `bun run test` e `bun run lint:types` instalam as dependências registradas em `bun.lock`, compilam os plugins, executam testes sobre os arquivos gerados e verificam os tipos. Os testes simulam os contratos de Flux, módulos, armazenamento e animações do Next. Os testes de comportamento também são executados antes de publicar versões.

Após atualizar no Android:

1. **Auto Translator:** execute `!tr status`, `!tr test` e `!tr out status`; confira se os comandos permanecem locais e se uma mensagem recebida é traduzida. Para testar o envio original, use `!tr out off`.
2. **Large Video Sender:** envie um vídeo de teste acima do limite da conta e confira o tamanho final. Anote duração, tamanho original, limite informado e qualquer erro.
3. **Fix Link:** envie uma URL suportada e a mesma URL entre crases. Confira se somente a primeira foi convertida e se a prévia carrega.
4. **Motion:** reinicie o Discord, troque de canal e teste botões. Confira também o comportamento com a opção de reduzir movimento do Android.

Os testes automatizados não substituem essa verificação no dispositivo. Ao relatar uma falha, inclua as versões do Discord, Revenge Next e plugin, o resultado esperado e uma captura do erro ou diagnóstico.

Abaixo está a documentação original do template de desenvolvimento.

---

# Revenge Plugin Template

This repository is a starter monorepo for external Revenge plugins. Each plugin becomes one ZIP
file. One repository can hold any number of plugins under `plugins/`.

A plugin has up to three parts. Its own `manifest.json` declares all of them:

- **`dist.android`** is native Kotlin code. The build compiles it to a DEXed JAR, and the plugin loader loads it with `DexClassLoader`.
  This code runs early, before the JS bundle.
- **`dist.script`** is the JavaScript bundle. The Revenge JS side runs it.

## Layout

Each folder under `plugins/` is one plugin. A plugin is **native** when it has a `src/main` folder.
A plugin is **JS-only** when it has only a JS entry file. A plugin can have both.

```
├── plugins/
│   ├── example-plugin/            # Native + JS
│   │   ├── manifest.json          # id, metadata, dist.* paths
│   │   ├── src/main/kotlin/com/example/plugin/MyPlugin.kt   # -> plugin.jar
│   │   └── js/index.ts            # -> index.js
│   ├── example-js-plugin/         # JS-only: no src/main, no dist.android
│   │   ├── manifest.json
│   │   └── js/index.ts
│   ├── example-library/           # Dependency example: the plugin others depend on
│   └── example-dependent/         # Dependency example: depends on com.example.library
```

The bundler looks for the JS entry in this order: `js/index.*`, then `src/index.*`, then `index.*` in the plugin folder.
Each step accepts `.ts`, `.tsx`, `.js` and `.jsx`.

To add a plugin, create `plugins/<name>/manifest.json` and add a `src/main` folder for native code, a JS entry file, or both.

## Prerequisites

- **JDK 25 or later** and the **Android SDK**, with `build-tools` and `platform 36`.
  Don't forget to set `sdk.dir` in `local.properties`, or set the `ANDROID_HOME` environment variable.
- **[Bun](https://bun.com/)** or **[Node.js](https://nodejs.org/)**.
- **The Revenge plugin API in your local Maven repository.** Run this in the `revenge-xposed` repository:

  ```sh
  ./gradlew :api:publishToMavenLocal
  ```

  The task publishes `io.github.revenge:api`. `gradle/libs.versions.toml` pins the version.

## Build

Build and package every plugin:

```sh
./gradlew packageAllPlugins
```

The task writes one `build/dist/<id>@<version>.zip` per plugin. Each ZIP holds `manifest.json`, the
dexed JAR of a native plugin, and the JS bundle of a plugin that has one. The version comes from
`manifest.json`, so an artifact always states which version it holds.

Build one plugin, or only one part of it:

```sh
./gradlew packageExamplePlugin              # one plugin -> build/dist/<id>@<version>.zip
./gradlew :plugins:example-plugin:dexJar    # native only -> plugins/example-plugin/build/outputs/plugin/plugin.jar
bun install                                 # install the dependencies
bun run build                               # every JS bundle -> plugins/<name>/build/js/index.js
bun run build example-plugin                # the JS bundle of one plugin
```

Gradle derives each package task name from the folder name, example: `plugins/example-plugin/` gives `packageExamplePlugin`.

## `manifest.json`

```jsonc
{
  "format": 1,                      // manifest format version. Required. Always 1 today.
  "id": "com.example.plugin",       // also the folder name on disk
  "name": "Example Plugin",
  "description": "...",
  "author": "Your Name",
  "version": "1.0.0",               // the version of this plugin. Required.
  "dependencies": {                 // keyed by plugin id
    "revenge.api": { "version": ">=1" },
    "discord": { "version": "*" }
  },
  "dist": {
    "script": "index.js",           // relative to the plugin folder
    "android": {
      "path": "plugin.jar",         // relative to the plugin folder
      "class": "com.example.plugin.MyPlugin"  // the class that exposes the `plugin {}` val
    }
  }
}
```

### `version`

Revenge uses its own version scheme. A version is one or more integer segments.
One lowercase alphanumeric prerelease label can follow. `1.0.0`, `2026.7` and `1.2.0-beta2` are all valid.

Two rules control the order:

- A short version compares as right-padded. `1.2` equals `1.2.0`.
- A labeled version always sorts before its bare version. `1.2.0-rc` is lower than `1.2.0`.

This scheme looks like SemVer, but it is not SemVer. A CalVer-shaped version works equally well.

### `dependencies`

`dependencies` is a map, and each key is a plugin id:

```jsonc
"dependencies": {
  "com.example.library": { "version": ">=1.0 <2", "optional": false }
}
```

Every field inside the value is optional. `{}` means `{ "version": "*" }`, which accepts any version.
The key itself must still exist. The host never assumes a dependency that you do not declare.

A version range uses explicit bounds only: `<`, `<=`, `=`, `>=` and `>`, separated by spaces.
The range syntax has no `^` and no `~`. The `"*"` wildcard accepts every version.

Ranges are checked at install time, at every boot, and when the user enables the plugin.
Plugins don't load when required dependencies fail or don't satisfy the version requirements.

Dependencies are resolved **by ID** against the repositories that the user enabled.
When a dependency lives in another repository, the user must add that repository before installing the plugin.

The `example-library` and `example-dependent` pair shows this. The dependent declares `"com.example.library": { "version": ">=1" }`.
An install therefore also installs the library. The library always loads and starts first.

If the library is missing or out of range, the dependent never loads.

### Optional dependencies

`"optional": true` marks a dependency that never blocks your plugin.
Your plugin still loads when that dependency is missing, out of range, or broken.

When the dependency is present, it loads before your plugin, and its code are linked and made available to your plugin.

To detect the dependency, probe for one of its classes:

```kotlin
val themesAvailable = runCatching {
    Class.forName("com.example.themes.ThemeApi", false, javaClass.classLoader)
}.isSuccess
```

Keep all code that touches the optional API in a separate adapter class. Reference that class only after the probe succeeds.
A reference to a missing class stays safe until a code path runs it.

In JS, check if your plugin API is decorated:

```ts
start({ themes }) {
    const themesAvailable = !!themes
}
```

### Reserved IDs

Two dependency IDs are reserved.

- **`revenge.api`** resolves to the Revenge release version, which is the plugin API version.
  This dependency is **mandatory**. Constrain it to the API versions you tested, for example `">=1 <2"`.
- **`discord`** resolves to the Discord app version, for example `>=355.0`.

## Native plugins

A native plugin is a **top-level `val`** that you build with the `plugin {}` DSL. You implement no
interface, and you subclass nothing. The host reads the class that `dist.android.class` names, and
takes the first `PluginBuilder` value it exposes. You import and use a Ktor plugin value the same
way.

```kotlin
@file:JvmName("MyPlugin") // makes dist.android.class read as com.example.plugin.MyPlugin

package com.example.plugin

import io.github.revenge.plugins.plugin
import io.github.revenge.xposed.api.registerMethod

val myPlugin = plugin {
    start {
        log.i("Loaded ${manifest.id} in ${appInfo.packageName}")
        registerMethod("${manifest.id}.ping") { "pong" }
    }
    stop {
        log.i("Unloaded ${manifest.id}")
    }
}
```

A Kotlin top-level `val` compiles into a file-facade class. `MyPlugin.kt` becomes `MyPluginKt`.
The `@file:JvmName("MyPlugin")` annotation renames that facade. `dist.android.class` can then use the clean name `com.example.plugin.MyPlugin`.

If you omit the annotation, point `dist.android.class` at `...MyPluginKt`.
Declare exactly one `plugin {}` val in the file that the manifest names.

The host provides the Revenge API, the Xposed API, coroutines and the Kotlin standard library. The
build marks them `compileOnly`. The host class loader supplies them at runtime, so the JAR must not
contain them.

> **Note:** `d8` can print a `malformed kotlin.Metadata` warning. This warning is not fatal.
> The SDK metadata library is older than the Kotlin compiler. `d8` still writes a correct DEX, and the DEX loads.
> Only the rewrite of Kotlin reflection metadata stops.

## Distribution

This template is also a **plugin repository**. A repository is a static host that serves `index.json`
describing every published plugin channels, versions, absolute artifact URLs, and SHA-256 digests.

A user can add the repository URL in Revenge. Browsing, dependency resolution and updates all run on the client.

### Channels

A **channel is a named pointer into the published versions of one plugin**. In `index.json` each plugin carries both maps:

```jsonc
"channels": { "latest": "1.2.0", "beta": "1.3.0-beta" },
"versions": { "1.2.0": { /* … */ }, "1.3.0-beta": { /* … */ } }
```

`versions` holds the artifact data. `channels` only states which published version an audience gets.

The client picks a channel at install time, and it follows that pointer for update checks.
A stable user never sees a beta, because the `latest` pointer never points at one.

**Automatic pointers**:

- `latest` is the newest version with **no label**. `1.2.0` qualifies. `1.3.0-beta` never does.
- `beta` is the newest version **overall**. The generator emits it only when it differs from `latest`.
  When your newest release is stable, no `beta` pointer exists.

**Manual overrides**: Use the `channels` key in `repo.config.json`, keyed by plugin ID:

```jsonc
{
    "name": "My Plugin Repository",
    "channels": {
        "com.example.plugin": {
            "latest": "1.1.4", // keep latest on 1.1.4, for example when 1.2.0 shipped broken
            "lts": "1.0.9" // or add a channel of your own
        }
    }
}
```

These rules apply:

- The generator computes `latest` and `beta` first. It then applies your overrides.
- An override must point at a published version of that plugin. Otherwise the generator fails.
- A channel name carries no version semantics. An `lts` version is the same artifact as its plain version.
  You only point at it for longer. To promote `beta` to `latest`, edit the pointer. No rebuilds or republishes.
- **A dependency never references a channel.** A dependency constrains versions only, so a mixed-channel install can resolve.

### The pool

Every published artifact lives in one flat directory on the published branch, next to the index:

```
pool/com.example.plugin@1.0.0.zip
pool/com.example.plugin@1.2.0.zip
pool/palmdevs.silent-typing@1.0.0.zip
index.json
```

The branch is `gh-pages` by default. To use a different one, set the `POOL_BRANCH` repository
variable under Settings, Secrets and variables, Actions. All three workflows read it, so one
variable moves the pool, the index and the migration together.

The pool is the **only** record of what is published. A version is published when its artifact is in
the pool, and `index.json` is a pure function of the directory. Regenerating it can never invent or
lose a version. To unpublish a version, delete its file and regenerate.

The `@` separator is in neither the ID charset nor the version charset, so both halves always parse.
The generator also opens every archive and compares the file name against the manifest inside it. A
mislabeled artifact fails the build instead of entering the index under the wrong version.

Git tags and GitHub Releases are written for changelogs only. Nothing reads them.

### Automated releases

Two workflows publish the repository. The CLI holds the release logic, and it never talks to a Git
host. Both workflows call it with local files. To port the repository to another host, you rewrite
the workflow steps and change no CLI code.

The workflows declare triggers, permissions and inputs only. Each step runs a script in
`.github/scripts/`, so you can run the same code on your machine and read a failure as a shell
error rather than a rendered YAML block.

`release.yml` runs on a push to `main`. It checks out the pool, then calls `plan-releases`, which
reads every `manifest.json` and lists the plugins whose version is not in the pool yet. The command
also refuses a downgrade. It fails when a manifest version is below the newest published version of
that plugin. The comparison uses the same order as the client, so a bare version wins over a labeled
one. You can promote `1.2.0-rc` to `1.2.0` without a failure.

The workflow then builds the planned plugins, copies the artifacts into the pool, regenerates the
index, and pushes **artifacts and index in one commit**. The branch never holds an index that points
at a file it does not have, and a run that fails part way publishes nothing. Re-running it is safe.

Because the pool is keyed by plugin ID, renaming a plugin folder keeps its release history.

Run the planner against a checkout of the published branch to see what a push would release:

```sh
git clone --branch gh-pages <your repo url> published
bun run plan-releases -- --pool published/pool
bun run plan-releases -- --pool published/pool --out plan.json
```

The planner writes nothing to the pool. `--pool` is required, because an absent directory looks like
an empty pool and would republish every version.

`publish-index.yml` runs on dispatch only. It regenerates `index.json` from the artifacts already in
the pool and commits it when it changed. Use it after you edit the `repo.config.json` channel
overrides, or after you delete an artifact to unpublish a version. Releasing does not need it.


### Serve a repository on your machine

You can test the full repository flow against your own builds: add the repository, browse it, install, and update.  
Build the ZIPs first, then start the dev server. The server regenerates the index and serves it beside the artifacts:

```sh
./gradlew packageAllPlugins   # or one package task
bun run serve                 # http://<your-lan-ip>:8080
```

Add the URL on the device as a repository. If the device cannot reach your IP, or if it blocks cleartext traffic, use loopback through ADB:

```sh
bun run serve -- --base-url http://127.0.0.1:8080
adb reverse tcp:8080 tcp:8080
```

The server rescans the dist folder on every index request.
Bump a manifest version, rebuild that plugin, and check for updates on the device. The new version will appear.
